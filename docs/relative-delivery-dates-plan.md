# Relative delivery dates

## Context

Today, when a letter or report segment has a `delivery_day_override_id`, that override is an **absolute pin** to a specific `days.id`. If you later move the parent letter group from D1 to D2, the pinned children stay where they are — breaking the visual link between a letter, its group, and the report it triggers.

The fix is to make per-letter and per-segment overrides **relative offsets** by default, anchored to the parent's effective day:

- **Inspection letter**: offset is relative to its letter group's delivery day. `effective_day = group_day + offset`.
- **Report segment**: offset is relative to the report's default delivery day, which itself is `triggering_letter_effective_day + 1`. So `effective_day = letter_effective_day + 1 + offset`. Reports happen at the top of a day and letters get sorted at end of day, so reports never deliver same-day as their trigger — minimum offset for reports is `+1` (i.e. report runs on letter_day + 2).

Absolute pinning is still supported as a secondary "pin to a specific day no matter what" affordance via the same picker, beneath a divider.

This change preserves group-driven rearrangement (move the group, all relative children follow), while keeping the escape hatch of absolute pinning. It ships in two phases so the inspection-letter side can be validated before touching report segments.

---

## Storage model

Add a new nullable signed-integer column alongside the existing UUID override on each table. CHECK constraint guarantees at most one of the two is set at a time. If both are null, the row uses its parent's day.

| Table | Existing | New | Meaning when set |
|---|---|---|---|
| `inspection_letters` | `delivery_day_override_id uuid` | `delivery_day_offset smallint` | `effective = group_day + offset` |
| `report_segments` | `delivery_day_override_id uuid` | `delivery_day_offset smallint` | `effective = letter_default_day + offset` (letter_default = letter_effective + 1) |

CHECK on each: `delivery_day_override_id IS NULL OR delivery_day_offset IS NULL`.
Additional CHECK on `report_segments`: `delivery_day_offset IS NULL OR delivery_day_offset >= 1`.

**Existing absolute overrides are auto-converted to relative offsets** as part of each phase's migration. The original intent was "this row should deliver on day X relative to its parent" — there was simply no way to express it as a delta before. Converting flips them to the new model so the rearrange-without-breakage benefit applies retroactively. Rows that can't be represented as an in-range offset (e.g. parent has no `delivery_day_id`, or for reports the offset would be `<1`) stay as absolute pins.

Conversion rules (run inside each migration as part of the same transaction that adds the column):

- **Inspection letters** (migration 0013):
  ```sql
  UPDATE inspection_letters il
  SET    delivery_day_offset = (d_override.number - d_group.number),
         delivery_day_override_id = NULL
  FROM   letter_groups lg
  JOIN   days d_group ON d_group.id = lg.delivery_day_id
  JOIN   days d_override ON d_override.id = il.delivery_day_override_id
  WHERE  il.letter_group_id = lg.id
    AND  il.delivery_day_override_id IS NOT NULL
    AND  lg.delivery_day_id IS NOT NULL;
  ```
  Rows whose group has no `delivery_day_id` keep their absolute pin (no group to anchor against).

- **Report segments** (migration 0014, after the letter migration has already run):
  ```sql
  WITH letter_default AS (
    SELECT rg.id AS report_group_id,
           COALESCE(
             (SELECT MIN(d_eff.number)
                FROM inspection_letters_view ilv
                JOIN days d_eff ON d_eff.id = ilv.effective_day_id
               WHERE ilv.letter_group_id = rg.letter_group_id),
             (SELECT d_lg.number FROM days d_lg
                JOIN letter_groups lg2 ON lg2.id = rg.letter_group_id
               WHERE d_lg.id = lg2.delivery_day_id)
           ) + 1 AS default_number
      FROM report_groups rg
  )
  UPDATE report_segments rs
  SET    delivery_day_offset = (d_override.number - ld.default_number),
         delivery_day_override_id = NULL
  FROM   letter_default ld
  JOIN   days d_override ON d_override.id = rs.delivery_day_override_id
  WHERE  rs.report_group_id = ld.report_group_id
    AND  rs.delivery_day_override_id IS NOT NULL
    AND  ld.default_number IS NOT NULL
    AND  (d_override.number - ld.default_number) >= 1;
  ```
  Rows where the converted offset would be `0` (= default, no override needed) get *both* columns nulled in a follow-up `UPDATE`. Rows where it would be `<0` (sub-default) stay as absolute pins.

After conversion, the CHECK constraint is added — guaranteeing no row violates the invariant. Each migration includes two sanity counts so the reviewer can see what happened:

```sql
-- must be 0
SELECT COUNT(*) FROM <table> WHERE delivery_day_override_id IS NOT NULL AND delivery_day_offset IS NOT NULL;
-- intentional: rows that couldn't convert (no parent day, or sub-default report) and kept their absolute pin
SELECT COUNT(*) FROM <table> WHERE delivery_day_override_id IS NOT NULL;
```

The second count is logged in the migration; an unexpected non-zero value lets us audit the leftover absolute pins before flipping the UI default.

---

## Phase 1 — inspection letters (build, then PAUSE for review)

### 1.1 Schema

New migration `supabase/migrations/0013_inspection_letter_delivery_offset.sql`:

- `ALTER TABLE inspection_letters ADD COLUMN delivery_day_offset smallint;`
- `ALTER TABLE inspection_letters ADD CONSTRAINT inspection_letters_delivery_exclusive CHECK (delivery_day_override_id IS NULL OR delivery_day_offset IS NULL);`
- `CREATE OR REPLACE VIEW inspection_letters_view AS ...` — replace the existing `coalesce(override_id, group.day_id)` with:

  ```
  effective_day_id =
    CASE
      WHEN il.delivery_day_override_id IS NOT NULL THEN il.delivery_day_override_id
      WHEN il.delivery_day_offset IS NOT NULL THEN (
        SELECT d.id FROM public.days d
        WHERE d.number = (
          SELECT d_lg.number FROM public.days d_lg WHERE d_lg.id = lg.delivery_day_id
        ) + il.delivery_day_offset
      )
      ELSE lg.delivery_day_id
    END
  ```

  If the computed day doesn't exist, `effective_day_id` is `null` — UI flags that as an error (see 1.5).

The `report_segments_view` is unchanged in Phase 1; in Phase 2 it picks up the new letter offset logic via the recomputed `inspection_letters_view`.

### 1.2 Types

`src/lib/db/types.ts`:
- Add `delivery_day_offset: number | null` to the `InspectionLetter` interface (lines 95–109).
- `InspectionLetterView` is unchanged externally — `effective_day_id` is still the consumer-facing field.

### 1.3 Server action

`src/app/(authed)/inspection/letters/actions.ts` → `patchInspectionLetter` (around line 766):

- Add `delivery_day_offset: number | null` to `InspectionLetterPatchFields`.
- When a caller patches `delivery_day_offset` to a non-null value, also set `delivery_day_override_id = null`.
- When a caller patches `delivery_day_override_id` to a non-null value, also set `delivery_day_offset = null`.
- "Clear override" = patch both to `null`.

Helper-style: the function normalizes the patch before the update so the mutual-exclusion invariant is preserved regardless of how the UI calls it.

### 1.4 UI — new `DeliveryDayPicker` component

The existing `DaySelect` (`workspace.tsx` lines 5388–5528) only knows about absolute day IDs. Rather than overload it, build a new component `DeliveryDayPicker` in `src/app/(authed)/inspection/letters/delivery-day-picker.tsx` and use it from the letter detail panel.

Props:
```ts
{
  base: { dayId: string | null; offsetFromBase?: number };
  override:
    | { kind: 'none' }
    | { kind: 'offset'; offset: number }     // signed for letters
    | { kind: 'absolute'; dayId: string };
  days: Day[];
  allowNegative: boolean;                    // true for letters, false for reports
  minOffset?: number;                        // 1 for reports, undefined for letters
  defaultLabel?: string;                     // "(Delivery Default)"
  onChange: (next: Override) => void;        // emits {kind:'none'|'offset'|'absolute', ...}
}
```

For letters, the parent passes `base.dayId = groupDeliveryDayId` and `base.offsetFromBase = 0`. The picker computes `displayDayNumber(offset) = base.day.number + offset`.

Menu structure when opened:

1. **Relative section** (top)
   - `+1 Day (DX)`
   - `+2 Days (DX)`
   - `+X Days (DX)` — last row contains an inline number input + `−` / `+` buttons; pressing Enter or clicking the row label commits.
     - Letters: signed integer. If input resolves to `+1` or `+2` (an existing baked-in option), the *baked-in* row is highlighted instead of `+X`. If input resolves to `0` (= group default), emit `{ kind: 'none' }` — same as picking "Clear override".
     - Negative-allowed letters also surface `-1 Day (DX)` / `-2 Days (DX)` rows above the `+X` row.
   - Each row's `(DX)` suffix is computed live from `base.day.number + offset`. If the resulting day doesn't exist in `days[]`, render the suffix as `(no day)` in muted text — but the row is **still selectable**. Committing it persists the offset; the picker's closed button and the inline error in 1.5 surface the broken state. (This keeps a single coherent invalid-day path instead of branching between "rejected pick" and "accepted-but-flagged".)
2. **Divider**
3. **Absolute section** (existing day list)
   - One row per day in `days[]`, label `D{n}` (+ name if present).
   - The day equal to `base.dayId` (letters: group day; reports: computed default day) is **disabled and suffixed `(Delivery Default)`** — choosing it is a no-op, so we just grey it out.
4. **"Clear override"** row at the bottom (only shown if override is currently set).
5. **`+ Day`** quick-create row (reuses `createNextDay` from existing `DaySelect`).

**Input parsing for `+X Days`:**
- The input keeps a string draft (`""`, `"-"`, `"3"`, etc.) while typing. Letters allow a leading `-`.
- Commit (on Enter, on `+`/`−` button, or on row click) parses with `Number(raw)`. If `!Number.isInteger(parsed)` or the value violates `allowNegative`/`minOffset`, do nothing — leave the draft alone, don't fire `onChange`.
- Sign flips mid-edit are fine since the parse only runs on commit.
- Plus/minus buttons increment from the current parsed value (or 0 if draft is unparseable) with the same bounds.

Closed-button text:
- `none` → `D{base.number}` (plain).
- `offset` → `D{base.number + offset}` (e.g. "D3"). If the computed day doesn't exist, show `D?` in destructive color.
- `absolute` → `D{n}` for the pinned day.

When the menu reopens, the highlighted row reflects current state: an offset of `+1` highlights the baked-in `+1 Day` row; an offset of `+5` highlights `+X Days` with `5` populated in the input.

### 1.5 UI — letter detail panel changes

`src/app/(authed)/inspection/letters/workspace.tsx` around lines 2731–2773:

- Rename the read-only label `Group delivery` → `Delivery`.
- The value under "Delivery" continues to show the group's `delivery_day_id` (`D{n}`). When the letter has any override set (offset OR absolute), wrap that text in a `line-through` style. This visually communicates "the group's day no longer applies to this letter."
- Replace the `DaySelect` block beneath "Delivery override" with the new `DeliveryDayPicker`. Wire `onChange` through `patchInspectionLetter` via the existing `useInstantField` flow (`deliveryOverrideField`) — but the patch now carries one of `{delivery_day_offset: n}`, `{delivery_day_override_id: id}`, or both-null (clear).
- Field-highlight peer key stays as `delivery_day_override_id` for cursor-tracking parity; we can introduce a second peer key (`delivery_day_offset`) later if useful.
- If `effective_day_id` is `null` (computed offset points to a non-existent day), render a small destructive-styled error message beneath the picker: `"Override resolves to D{n}, which doesn't exist. Pick a valid day or clear the override."`

### 1.6 Graph drag (letters)

Currently the graph only drags **letter groups**, not individual letters. Nothing to change for Phase 1.

### 1.7 Tests / verification (Phase 1)

End-to-end manual verification:

1. `pnpm db:migrate` runs cleanly; `inspection_letters_view.effective_day_id` returns expected values for: no-override letter, offset letter, absolute-pinned letter, offset pointing to a non-existent day (→ null).
2. `pnpm typecheck` clean.
3. Dev server (`pnpm dev`):
   - Open a letter; the field reads "Delivery" with a `D{n}` value.
   - Set override = `+1 Day` → button shows `D{group+1}`; `D{group}` above it gets strikethrough.
   - Reopen the picker → `+1 Day (D{group+1})` is the highlighted row.
   - Switch to `+X Days`, type `5`, commit → button shows `D{group+5}`; reopen menu highlights `+X Days` with `5` populated.
   - Switch to absolute `D{some-other-day}` → behaves identically to today's pin.
   - Picking the absolute day equal to the group default is disabled and labeled `(Delivery Default)`.
   - Use "Clear override" → both columns null in the DB; closed button shows the group day, no strikethrough.
   - Move the parent group from D2 to D3 via the graph; the offset letter follows to D3+offset (the absolute-pinned letter does not move).
   - Set override to `+99` (a day that doesn't exist) → red error renders under the picker.
4. Realtime: in two browser tabs, change a letter's offset in one tab; the other tab reflects it via existing postgres_changes subscription on `inspection_letters`.

**PAUSE HERE for user review before Phase 2.**

---

## Phase 2 — report segments

### 2.1 Schema

New migration `supabase/migrations/0014_report_segment_delivery_offset.sql`:

- `ALTER TABLE report_segments ADD COLUMN delivery_day_offset smallint;`
- CHECK: `delivery_day_override_id IS NULL OR delivery_day_offset IS NULL`.
- CHECK: `delivery_day_offset IS NULL OR delivery_day_offset >= 1`.
- `CREATE OR REPLACE VIEW report_segments_view AS ...` — the `effective_day_id` now uses three layers:

  ```
  effective_day_id =
    CASE
      WHEN rs.delivery_day_override_id IS NOT NULL THEN rs.delivery_day_override_id
      ELSE (
        SELECT d.id FROM public.days d
        WHERE d.number = letter_default_number + COALESCE(rs.delivery_day_offset, 0)
      )
    END
  ```

  `letter_default_number` is computed once per report group in a CTE so the per-row expression stays flat, instead of nesting correlated subqueries inside `effective_day_id`:

  ```sql
  WITH report_base AS (
    SELECT
      rg.id AS report_group_id,
      COALESCE(
        (SELECT MIN(d_il.number)
           FROM inspection_letters_view ilv
           JOIN public.days d_il ON d_il.id = ilv.effective_day_id
          WHERE ilv.letter_group_id = rg.letter_group_id),
        (SELECT d_lg.number FROM public.days d_lg WHERE d_lg.id = lg.delivery_day_id)
      ) + 1 AS default_number
    FROM public.report_groups rg
    JOIN public.letter_groups lg ON lg.id = rg.letter_group_id
  )
  ```

  The view then joins `report_base` on `report_group_id`. This keeps the report base coherent with whatever the new letter logic computes, and gives the planner a single materializable derived table rather than per-row subqueries. **Runtime cost still needs verification on real data** — if the planner doesn't inline cleanly, fall back to a materialized helper view or a SQL function.

### 2.2 Types

`src/lib/db/types.ts`: add `delivery_day_offset: number | null` to `ReportSegment` (lines 151–161).

### 2.3 Server actions

`src/app/(authed)/inspection/letters/actions.ts`:

- `patchReportSegment` (line 849): add `delivery_day_offset`; same mutual-exclusion normalization as `patchInspectionLetter`.
- `moveReportSegmentToDay` (line 156): rewrite to compute offset against the report's default day:
  - Look up triggering letters' min effective day, add 1 → `default_number`.
  - `offset = target_day.number - default_number`.
  - If `offset === 0` → both columns null (= default).
  - If `offset >= 1` → save `delivery_day_offset = offset`, `delivery_day_override_id = null`.
  - If `offset < 1` (drag to earlier than the default, including same-day as letter) → fall back to absolute pin: save `delivery_day_override_id = target_day.id`. This is the only path to a sub-default report day, since the relative menu forbids it.
- `batchMoveToDay` (line 393): apply the same logic for `kind: 'report'`.

### 2.4 UI — report segment detail panel

`src/app/(authed)/inspection/letters/workspace.tsx` around lines 3248–3291:

- Rename label `Delivery day` → `Delivery`.
- The "Delivery" read-only value shows the **default report day** (computed `letter_min_effective + 1`) as `D{n}`. When an override (offset OR absolute) is set, strikethrough this value.
- Replace the `DaySelect` with `DeliveryDayPicker` configured as:
  - `base.dayId = letter_min_effective_day_id` and `base.offsetFromBase = 1` — so the picker treats `letter_day + 1` as the "default" baseline. (Equivalently, expose a `baseOffset` prop on the picker so reports pass `1` and letters pass `0`.)
  - `allowNegative: false`, `minOffset: 1`.
  - Relative menu shows `+1 Day (DX)`, `+2 Days (DX)`, `+X Days (DX)` only. `+X` input has plus/minus buttons; typed values `<1` don't commit (silently held as draft). The default-equivalent value would be `+0`, which the menu doesn't surface — clearing is via the explicit "Clear override" row.
  - Absolute section + `(Delivery Default)` greying behave the same way, where the "default" day is the computed default report day, **not** the group day. (Picking the default-equivalent absolute day is disabled.)
- Trigger pills (lines 3318–3352): each pill is already a single-letter button. Add a tooltip (`title=` for now; consider Radix tooltip later) showing the triggering letter's effective day, e.g. `"L-W2/b3 · D3"`.
- The "Delivery" label itself also gets a hover tooltip showing each triggering letter's day on hover (use a Radix tooltip / `title` listing all triggers). Reuses the `triggers` memo at lines 3179–3201.

### 2.5 Graph drag (report segments)

`src/app/(authed)/inspection/letters/actions.ts` → `moveReportSegmentToDay` and `batchMoveToDay` already updated in 2.3 to store offsets. The graph's `forceNarrow` selection and React Flow drop handlers don't need changes — they call those same actions.

### 2.6 Downstream callers that still assume absolute-only overrides

Audit and update as part of Phase 2 (Codex flagged these — they currently read raw `delivery_day_override_id` and would silently mis-handle offset rows):

- **Graph undo payloads** (`src/app/(authed)/graph/graph-view.tsx` ~1441–1453, ~1499–1511): change the undo record from `previousDayId: seg.delivery_day_override_id` to a discriminated `previousOverride: { kind: 'none' | 'offset' | 'absolute', value? }`. Server actions accept the union and restore both columns coherently. Also audit `graph-view.tsx` ~443–446 and ~906–909 where override IDs are read for layout.
- **Letter list override badge** (`src/app/(authed)/inspection/letters/workspace.tsx` ~6666–6684): the badge currently shows only when `delivery_day_override_id` is set. Update the predicate to `delivery_day_override_id !== null || delivery_day_offset !== null`.
- **Day routes** (`src/app/(authed)/days/[identifier]/inspection/page.tsx` ~26–33, `src/app/(authed)/days/[identifier]/top-of-day/page.tsx` ~99–104): both filter/query on `effective_day_id` already (good — no change needed if the view recomputes correctly), but confirm they don't separately read `delivery_day_override_id` for any label or filter logic.
- **Storyline-scoped legacy form actions** (`src/app/(authed)/inspection/storylines/[id]/groups/[groupId]/actions.ts` ~62–83, ~163–178): these still pass `delivery_day_override_id` only. Either add `delivery_day_offset` to the form fields, or mark them as legacy in a TODO comment if the storyline form is on its way out. (Decision deferred — flag for the implementation pass.)
- **Existing tests** (`src/app/(authed)/inspection/letters/actions.test.ts` ~236–274): the `moveReportSegmentToDay` tests assert absolute-pin behavior. Update to assert offset-storage for in-default-range drags and absolute fallback for sub-default drags.

### 2.6 Tests / verification (Phase 2)

1. Migrate, typecheck, lint clean.
2. Dev server:
   - Open a report segment; "Delivery" reads `D{letter_day+1}` (the computed default).
   - Set override `+1 Day` → button shows `D{letter_day+2}`; the default `D{letter_day+1}` above is strikethrough.
   - Move the triggering letter forward by setting its own override; the report's displayed default shifts accordingly. The `+1 Day` offset still applies relative to the new letter day.
   - Move the parent letter group; non-overridden reports and letters all shift; the +1 report stays at `letter_day+2`.
   - Drag a report segment on the graph one day later — verify it's stored as `delivery_day_offset = old_offset + 1`, not as an absolute pin.
   - Drag a report segment earlier than its default — falls back to absolute pin.
   - Hover trigger pill → tooltip shows letter content_id + that letter's effective day.
3. Confirm `report_segments_view.effective_day_id` resolves correctly when:
   - No override anywhere → `letter_min + 1`.
   - Letter has offset only → uses that.
   - Report has offset only → adds to default.
   - Report has absolute pin → wins over everything.

---

## Critical files

| Area | Path |
|---|---|
| Migrations | `supabase/migrations/0013_inspection_letter_delivery_offset.sql` (new), `supabase/migrations/0014_report_segment_delivery_offset.sql` (new) |
| Types | `src/lib/db/types.ts` (lines 95–109, 151–161) |
| Server actions | `src/app/(authed)/inspection/letters/actions.ts` (`patchInspectionLetter` ~766, `patchReportSegment` ~849, `moveReportSegmentToDay` ~156, `batchMoveToDay` ~393) |
| New picker | `src/app/(authed)/inspection/letters/delivery-day-picker.tsx` (new) |
| Letter panel UI | `src/app/(authed)/inspection/letters/workspace.tsx` ~2731–2773, `currentDayId` calc ~2636 |
| Report panel UI | `src/app/(authed)/inspection/letters/workspace.tsx` ~3248–3291, trigger pills ~3318–3352, `triggers` memo ~3179 |
| Existing `DaySelect` to retire (or repurpose internally) | `src/app/(authed)/inspection/letters/workspace.tsx` ~5388–5528 |
| Day formatter | `src/lib/db/days.ts` (`normalizeDayIdentifier`) — unchanged but reused |
| Plan files reference | `docs/inspection-letters-plan.md`, `docs/narrative-graph-plan.md` |

## Realtime / concurrent-edit caveat

`useInstantField` currently drops remote updates while a field is dirty/saving and reverts to the upstream value on save error. With a composite override (two related columns), a peer's concurrent flip between offset and absolute could be silently overwritten or briefly hidden from the local user. The DB CHECK protects the row from corruption, but the UX can race:

- **Minimum**: when `patchInspectionLetter` / `patchReportSegment` save fails because of the CHECK (shouldn't happen if the server action normalizes correctly, but defense in depth), surface an explicit "conflict — peer changed delivery" toast instead of silently snapping back.
- **Better (deferred)**: model the picker's value in `useInstantField` as a single discriminated union (`{ kind: 'none' | 'offset' | 'absolute', ... }`) so the dirty/save state covers both columns atomically, and remote updates that change `kind` get explicit conflict handling rather than silent overwrite.

Phase 1 ships the minimum; the union-modeled hook upgrade can be deferred to a follow-up if the basic case behaves.

## Things left out on purpose

- No new `delivery_day_offset` field-highlight peer key (reuses `delivery_day_override_id`); revisit if cursor tracking feels off.
- No retroactive UI surface for "this row was auto-converted in the migration" — the post-migration state simply *is* the new model; nothing to flag.
- Trigger-pill tooltip uses `title=` (Phase 2) rather than a Radix tooltip component; upgrade later if hover UX warrants.
- Union-modeled `useInstantField` upgrade is deferred (see "Realtime / concurrent-edit caveat" above).
