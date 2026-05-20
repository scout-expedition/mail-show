# Sorting Rules Page — UI Revamp

## Context

`/sorting/rules` is currently a flat accordion list. Each `RuleRow` expands inline
to a grid of dropdowns/inputs, conditions are capped at 3 and need an explicit
"Save conditions" button, and the rule pill is a pentagon. The goal is to bring
this surface up to the standard of the other inspection surfaces (letters
workspace, endings): a selectable list that opens a real **inspection side
panel**, pill-based condition editing with autosave, contradiction detection,
unlimited conditions, structured first/middle/last names, and a `day_cancelled`
field.

This revamp spans three areas — the **data model** (migrations + structured
names), the **page layout + panel**, and the **conditions editor**. All three
land together on the `sorting-rules-revamp` branch.

Key infrastructure being reused:
- `PanelHeader`, `OverflowMenu`, `GHOST_FIELD`, `Spinner` — `src/components/panel.tsx`
- `useConfirm()` — `src/components/confirm-dialog.tsx`
- `useInstantField()` — `src/lib/realtime/use-instant-field.ts` (debounced instant-save)
- `WorkspacePresenceProvider` / `FieldHighlight` — realtime presence
- `DaySelect` — the letter-group delivery-day dropdown (currently inline in `workspace.tsx`)
- Endings `ChipPill` invisible-`<select>` segment technique — `src/app/(authed)/endings/_blocks/chip.tsx`
- Endings shadow-row error styling — `src/app/(authed)/endings/_blocks/condition-block.tsx`

---

## 1. Database & data model

Two new migration files, applied directly via the Supabase MCP `apply_migration`
(one call each — `pnpm db:migrate` is not idempotent against a populated DB), and
checked into `supabase/migrations/`. Split into two files because
`ALTER TYPE … ADD VALUE` and statements that *use* the new value cannot share a
transaction.

### `0040_sorting_structured_names.sql`

- **Dependent views (do this first)** — `public.sorting_letters_view` is defined
  `select sl.*` in `0001_init.sql`, which pins `recipient_name`/`sender_name` and
  will make `DROP COLUMN` fail. `drop view if exists public.sorting_letters_view`
  before the `sorting_letters` column surgery and recreate it (`create view … as
  select sl.* from public.sorting_letters sl …`, original definition) afterward —
  a `select *` view recreated post-migration picks up the new column shape
  automatically. First run a `pg_depend` scan for any other view / index / RLS
  policy / generated column referencing `citizens.name`,
  `sorting_letters.recipient_name`, or `sorting_letters.sender_name`, and
  drop+recreate anything that surfaces.
- **citizens** — `add column if not exists first_name / middle_name / last_name text`.
  Backfill from existing `name` by word-split (first word → first_name, last word →
  last_name, words between → middle_name; single-word → first_name only; guarded
  `where first_name is null` for idempotency). Then convert `name` to a **stored
  generated column**: `drop column name` → `add column name text generated always
  as (concat_ws(' ', first_name, middle_name, last_name)) stored` (keep `NOT NULL` —
  `concat_ws` never returns NULL). Guard the conversion with an
  `information_schema.columns … is_generated = 'NEVER'` check so re-runs are no-ops.
- **sorting_letters** — `add column if not exists` for `recipient_first_name /
  recipient_middle_name / recipient_last_name` and the three `sender_*` equivalents.
  Backfill from `recipient_name` / `sender_name`. Convert both `recipient_name` and
  `sender_name` to generated columns:
  `nullif(btrim(concat_ws(' ', …)), '')` (these were already nullable — preserve
  null-when-empty).
- **rule_target enum** — `alter type public.rule_target add value if not exists` for
  `sender_first_name, sender_middle_name, sender_last_name, recipient_first_name,
  recipient_middle_name, recipient_last_name`.

### `0041_sorting_rules_unlimited_conditions.sql`

- **Preflight guard** — a leading `DO` block checks `pg_enum` for the six new
  `rule_target` labels and `raise exception` if any are missing, so `0041` cannot
  be applied before `0040`.
- Convert legacy conditions: `update sorting_rule_conditions set target =
  'sender_first_name' where target = 'sender_name'` (and the recipient equivalent).
- Replace the 3-condition cap: `drop constraint if exists
  sorting_rule_conditions_position_check` (confirm the name via `pg_constraint`),
  then `add constraint … check (position >= 1)` — keep a floor invariant rather
  than removing the check outright. `UNIQUE (rule_id, position)` stays.
- Add `day_cancelled_id`: `alter table sorting_rules add column if not exists
  day_cancelled_id uuid references public.days(id) on delete set null`.
- Add `routes_to_reporting boolean not null default false` to `sorting_rules` —
  the "Reporting" slot option. Mutually exclusive with `destination_slot`,
  enforced by a CHECK: `not (routes_to_reporting and destination_slot is not
  null)`. The destination is thus a three-way choice: unset (both null/false),
  a numeric slot 1–8, or Reporting.

**Risks:** the name word-split is lossy for multi-word surnames ("van der Berg") —
acceptable, authors can correct rows afterward. Dropping/re-adding a published
column is safe (replica identity FULL persists). Legacy `sender_name`/`recipient_name`
enum values can't be dropped — they stay, kept in `RULE_TARGET_LABELS` as a render
fallback and excluded from the new picker. The `0040` backfill UPDATEs every
citizen + sorting-letter row, emitting a one-time burst of realtime events —
benign for an internal tool; apply during low activity.

### Types & enums

- `src/lib/db/types.ts` — `Citizen` gains `first_name/middle_name/last_name`;
  `SortingLetter` gains the six `*_first/middle/last_name` fields; `SortingRule`
  gains `day_cancelled_id: string | null` and `routes_to_reporting: boolean`.
- `src/lib/db/enums.ts` — append the six name-part values to `RULE_TARGETS`, add
  their `RULE_TARGET_LABELS`. Keep legacy `*_name` labels. Add a
  `SELECTABLE_RULE_TARGETS` (or `LEGACY_RULE_TARGETS` exclusion set) so the picker
  hides the legacy values.

### Evaluator & name write-sites

- `src/lib/rules/evaluate.ts` — add the six name-part keys (`string | null`) to
  `RuleContext`. `asTargetValue` already does a generic `ctx[target]` lookup, so no
  logic change. Update `tests/fixtures/builders.ts` (`makeRuleContext` defaults) and
  add name-part cases to `evaluate.test.ts`.
- **Generated columns reject direct writes** — every site that writes
  `name`/`recipient_name`/`sender_name` must write the parts instead. A shared
  `splitName(full)` helper goes in a new `src/lib/names.ts` (mirrors the SQL split).
  Write-sites to update: `src/app/(authed)/citizens/actions.ts` (create / bulk
  update / CSV import), `src/app/(authed)/citizens/citizens-editor.tsx` (the
  `nameField` `useInstantField` `onCommit` splits before `patchCitizen`),
  `src/app/(authed)/sorting/letters/actions.ts` (`updateSortingLetter` / bulk /
  `patchSortingLetter`). `src/components/address-block.tsx` keeps its single `name`
  input — the server action splits the posted value — so the form contract is
  unchanged. All *readers* are untouched (generated column still returns the string).

---

## 2. Shared extractions

- **`src/components/day-select.tsx`** (new) — move `DaySelect` + its private
  `DayOption` helper verbatim out of `inspection/letters/workspace.tsx:6045-6211`.
  `"use client"`; imports `createNextDay` from `inspection/letters/actions`.
  `workspace.tsx` deletes the inline copy and imports from the new module — the
  letter-group Delivery-day field keeps working unchanged.
- **`src/lib/rules/normalize.ts`** (new) — move `normalizeCondition`,
  `operatorsForSlice`, `referenceTypesFor`, `isNumericValue`, and the
  `BuilderCondition` type (re-exported as `EditableCondition`) out of
  `src/components/condition-builder.tsx`. Behavior identical; shared by the new
  editor and the contradiction detector.

---

## 3. Page layout — two-pane workspace

`src/app/(authed)/sorting/rules/rules-list.tsx` becomes a two-pane workspace
(keep the `RulesList` → `RulesListInner` + `WorkspacePresenceProvider` structure).

- **Slide mechanics** — a `w-[200%]` flex wrapper with two `w-1/2` tracks inside an
  `overflow-hidden` container. `translateX(0%)` at rest (list fills viewport),
  `translateX(-25%)` when a rule is selected (50/50 split: list narrows left, panel
  fills right). `transition-transform duration-150 ease-out`, matching the letters
  workspace.
- **List rows** — `RuleListRow` is a selectable button (no more accordion / "Expand
  all"). Shows the **diamond** pill, the summary (or "—"), the slot badge, a
  trailing chevron, and a selected highlight (`bg-accent/60` + `aria-current`).
  No per-row duplicate button (moves to the panel kebab). No `useInstantField` on
  rows — all editing moves into the panel.
- **URL deep-link** — `?rule=<letter>`. `page.tsx` becomes `async`, reads
  `searchParams`, resolves the letter to a rule id, passes `initialSelectedRuleId`.
  The client tracks selection **by id** (survives renames) and a
  `router.replace(\`?rule=\${letter}\`, { scroll: false })` effect re-derives the
  letter from the live row. The postgres_changes DELETE handler clears selection
  when the selected rule disappears.
- **`+ Rule`** — moves into the list pane as a client transition button (see §6).

### Rule pill: pentagon → diamond

Extract a tiny `RulePill({ letter, className })` component used by both the list
row and the panel header. Swap the polygon:
`points="12,2 22.46,9.6 18.47,21.9 5.53,21.9 1.54,9.6"` →
`points="12,2 22,12 12,22 2,12"`. Keep the centered letter label.

---

## 4. Rule inspection panel — `src/app/(authed)/sorting/rules/rule-panel.tsx` (new)

A client component mirroring the letters-workspace "Letter Group" card.

```
<div className="rounded-md border border-border bg-card">
  <PanelHeader title={`RR-${rule.letter}`} icon={<RulePill .../>} menu={<OverflowMenu .../>} />
  <div className="p-4 flex flex-col gap-3"> … fields … <ConditionsEditor/> </div>
</div>
```

Fields — reuse the existing `useInstantField` + `FieldHighlight` machinery
(`makeFocusKey` = `{ table: "sorting_rules", recordId: rule.id, field }`):

1. **Rule ID** (was "Letter") — `<Label>Rule ID</Label>`, 1-char uppercase input.
   Collision UX in §5.
2. **Delivery slot** (was a number input) — a `<Select>`: option `value=""` labelled
   `–` (unset), `1`–`8`, and **`Reporting`**. `slotField.onCommit` maps the three
   cases to `{ destination_slot, routes_to_reporting }`: unset → `{ null, false }`,
   a number → `{ N, false }`, Reporting → `{ null, true }`. The list-row badge
   shows `slot N` or `Reporting` accordingly.
3. **Day implemented** — the shared `<DaySelect>` (instead of the raw `<Select>`).
4. **Day cancelled** — NEW field, identical `<DaySelect>`, bound to a
   `dayCancelledField` → `patchSortingRule(id, { day_cancelled_id })`.
5. **Storage location** — unchanged `<Input>`.
6. **Summary** — unchanged `<Textarea>`.

The conditions block (§7) replaces the old `ConditionBuilderInline` + read-only
description + "Save conditions" button.

---

## 5. Rule ID rejection UX

`sorting_rules.letter` is UNIQUE. When the user sets a rule's letter to one another
rule already owns:

- **Pre-check in memory** — the panel has the full `rules` mirror.
  `letterField.onCommit` checks `rules.some(r => r.id !== rule.id && r.letter ===
  next)`; on collision it sets `rejectedLetter` state and `throw`s.
  `useInstantField`'s `saveError` path reverts `localValue` to the prior letter for
  free. A server-side `/unique/i` guard in `patchSortingRule` catches the peer race.
- **Indicator** — when `rejectedLetter` is set, render beside the reverted value:
  `<span className="text-xs text-destructive"><s>{rejectedLetter}</s></span>` — the
  attempted letter struck through in red. Cleared on the next keystroke
  (`onChange`) and on any realtime `rule.letter` change (effect).

---

## 6. Kebab menu & server actions

`src/app/(authed)/sorting/rules/actions.ts`:

- **`createRule`** — stop redirecting to the dead `/sorting/rules/{id}` route;
  `revalidatePath` and `return { id, letter }`. The `+ Rule` button calls it in a
  transition and selects the new rule.
- **`deleteRule`** — `revalidatePath` instead of `redirect` (a hard redirect tears
  down the realtime channel); the client closes the panel.
- **`duplicateRule`** — `return { id }` so the panel can select the duplicate;
  carry `day_cancelled_id` and `routes_to_reporting` in the insert payload.
- **`patchSortingRule`** — add `day_cancelled_id` and `routes_to_reporting` to the
  `patch` type; add the `/unique/i` guard.

Panel header `OverflowMenu` items: **Duplicate rule** (icon, disabled at 26 rules)
· divider · **Delete rule** (destructive, `useConfirm()` dialog). Removes the old
per-row duplicate icon and the bottom-of-panel "Delete rule" button.

---

## 7. Conditions editor — `src/app/(authed)/sorting/rules/conditions-editor.tsx` (new)

Replaces `ConditionBuilderInline`. Header shows `Conditions (N)` — count in parens,
no `/3`. "Add condition" is never disabled by count.

Each condition row = three pill groups, all built on a shared `<PillSegment>`
primitive that copies the endings `ChipPill` invisible-`<select>` technique (a
visible `aria-hidden` label span with an absolutely-positioned
`opacity-0` `<select>`/`<input>` overlay):

- **`<TargetPill>` — 3 segments:**
  1. **Subject** — Sender / Recipient / Current day of week / Counterfeit stamp.
  2. **Field** — First/Middle/Last Name, Citizen ID, City Name, City Code, Nation.
     Also offers Current day of week / Counterfeit stamp. **Hidden** when the
     subject is day/counterfeit.
  3. **Slice** — `whole` renders as nothing (a thin clickable strip keeps it
     reachable); `first_char`/`last_char` show their label. Hidden for nation /
     day / counterfeit.
  A new pure `src/lib/rules/condition-target.ts` provides `encodeTarget` /
  `decodeTarget` between the flat `rule_target` enum and a
  `{ subject, field }` composite. Picking a special in either menu flips the
  subject; legacy `*_name` decode to `first_name` (auto-migrates on next save).
- **`<OperatorPill>` — 1 segment, border-only, no background fill** (visually
  distinct from the colored target/comparator pills). Options =
  `operatorsForSlice(slice)`. Static for counterfeit (forced `is`) and nation
  (forced `=`).
- **`<ComparatorPill>` — 2 segments:** segment 1 = reference type — `abc` glyph for
  string, `123` glyph for number, and the implicit label ("an even number", etc.)
  for the `is`-family value-less types; segment 2 = the value input (text/number),
  omitted for value-less types. Numeric-error ring reuses `isNumericValue`; mid-typed
  numbers use the `numberDraft` local-draft pattern from `chip.tsx`.
  **When the field is Nation**, the comparator is replaced by a new `<NationPill>` —
  icon + name tinted with `nation.color_hex`, an invisible `<select>` of all
  nations, storing the nation **name** in `reference_value` (matches the evaluator).
- **`<MatchModeControl>`** — a border-only pill ("And" / "And/Or"), rendered once
  after row 1 when there is more than one condition.

### Contradiction detection

New pure `src/lib/rules/contradictions.ts` —
`detectContradictions(conditions, matchMode): { indices, message }[]`. Returns `[]`
for `matchMode: "any"`. Cases: equality clash (two `equals`, same target+slice,
different literals), boolean clash (`is_counterfeit` true vs false), numeric range
clash (empty interval intersection across `gt/gte/lt/lte` + numeric `equals`).
Conflicting rows get the endings shadow-row treatment but in **destructive** colors
(`bg-destructive/5 ring-1 ring-destructive/40` + an `AlertTriangle` error badge
with the message). Display-only — does not block autosave. Unit-tested in
`src/lib/rules/contradictions.test.ts`.

### Autosave

No "Save conditions" button. `saveConditions` stays a delete-all + insert-all
set-replace (condition IDs have no FK blast radius; the existing realtime mirror
already debounces INSERT/DELETE into one `router.refresh()`). The **client**
debounces: pill *value* edits commit after ~600ms; structural changes
(add/remove row, match-mode) commit immediately. Because `saveConditions` is a
full delete-all + insert-all set-replace, omitting an invalid row would **delete
the persisted condition** — so the payload always contains *every* row, and when
any row is in an invalid state (a numeric type with an empty/non-numeric value)
the entire debounced save is **held**: the invalid row stays a local-only draft
and nothing is written until every row is valid. The existing
`condsDirty`/`condServerKey` resync guard in `RuleRow` is preserved, driven by
the editor's dirty/pending state, so the editor doesn't snap back on its own
realtime echo. Flush on unmount.

`page.tsx` additionally queries `nations` and threads them through to the editor.

---

## 8. Cleanup

After the new path is verified: delete `src/components/condition-builder.tsx`
(both `ConditionBuilder` — already dead — and `ConditionBuilderInline`). Also
delete the dead `updateRule` and `saveRuleAll` server actions from `actions.ts`
(neither is called by the new panel — confirm via grep — and both would clobber
`routes_to_reporting` / `day_cancelled_id` if a caller were ever added).
`condition-description.tsx` may stay or be restyled. Keep the legacy
`/sorting/rules/[id]` redirect route (harmless, protects old bookmarks).

---

## Files

**New:** `supabase/migrations/0040_sorting_structured_names.sql`,
`supabase/migrations/0041_sorting_rules_unlimited_conditions.sql`,
`src/lib/names.ts`, `src/components/day-select.tsx`,
`src/lib/rules/normalize.ts`, `src/lib/rules/condition-target.ts`,
`src/lib/rules/contradictions.ts`, `src/lib/rules/contradictions.test.ts`,
`src/app/(authed)/sorting/rules/rule-panel.tsx`,
`src/app/(authed)/sorting/rules/conditions-editor.tsx`.

**Modified:** `src/lib/db/types.ts`, `src/lib/db/enums.ts`,
`src/lib/rules/evaluate.ts`, `src/lib/rules/evaluate.test.ts`,
`tests/fixtures/builders.ts`, `src/app/(authed)/inspection/letters/workspace.tsx`,
`src/components/condition-builder.tsx` (until deleted),
`src/app/(authed)/citizens/actions.ts`,
`src/app/(authed)/citizens/citizens-editor.tsx`,
`src/app/(authed)/sorting/letters/actions.ts`,
`src/app/(authed)/sorting/rules/{page,rules-list,actions}.tsx`.

---

## Verification

1. Apply `0040` then `0041` via Supabase MCP; re-apply each to confirm idempotency.
   Verify generated columns (`is_generated = 'ALWAYS'`), the new part columns,
   `day_cancelled_id`, the dropped position check (insert a 4th condition), and the
   enum range. Spot-check name backfill against multi-word names.
2. `pnpm typecheck` (catches every stale `name` write-site + missing type fields),
   `pnpm lint`, `pnpm test` (extended `evaluate.test.ts` + new `contradictions.test.ts`).
3. `pnpm dev` — `/sorting/rules`: click a rule → panel slides in, list narrows,
   URL gets `?rule=<letter>`; reload re-selects. Diamond pill renders. Rule ID set
   to a free letter saves; to a taken letter reverts with the struck-through red
   indicator. Delivery slot `–`/1–8 dropdown. Day implemented + Day cancelled use
   `DaySelect`; "+ Day" works. Kebab Duplicate/Delete. `+ Rule` creates + selects.
4. Conditions: add 4+ conditions; pill-edit target (3 segments) / operator /
   comparator; nation field shows the nation pill; autosave fires without a button;
   contradictory `all`-mode conditions show the destructive ring + badge.
5. Two browser sessions — presence rings on panel fields, peer edits fan out,
   peer-deleting the selected rule closes the panel.
6. Regression: the letters-workspace Delivery-day dropdown still works after the
   `DaySelect` extraction; citizen + sorting-letter name editing round-trips.

---

## Status — shipped 2026-05-19

The revamp landed in one big commit (`feat(sorting-rules): full revamp …`) plus
three rounds of polish in follow-up commits. Final migration set: `0041`–`0045`
(numbered around an unrelated `0040_updated_by_delete_attribution.sql` that
merged to `main` while the branch was open).

### What shipped vs. the plan

**Sections 1 (DB + types), 2 (extractions), 3 (page layout), 4 (panel),
5 (collision UX), 6 (server actions), 7 (conditions editor), 8 (cleanup) —
all done.**

Plus three rounds of feedback-driven polish on top of the plan:

- **Round 2 — per-target operator/comparator matrix.** Replaced the
  `operatorsForSlice` + `VALID_OPERATOR_REFERENCES` machinery with a
  target-aware matrix in `src/lib/rules/normalize.ts`
  (`operatorsFor` / `referenceTypesFor` / `slicesFor` / `comparatorLabel`).
  Added new operators `not_equals` / `not_contains` / `is_not`, a new ref
  type `letter_set` ("these letters"), and dedicated pickers `NationPill`
  (tinted by `color_hex`), `CityPill` (whole-city is/is_not dropdown),
  `WeekdayPill` (day-of-week). Inspection-panel polish: kebab-only
  PanelHeader (no close button), fixed-width list (panel never reflows the
  list), insert-block-style "+ condition" button. Migration **0043**.
- **Round 3 — digit ref types + Or mode.**
  Added `digit` ("this number") and `digit_set` ("these numbers") ref types
  (migration **0044**), expanded the city-code / citizen-id first/last-char
  matrix to the full eight-option family (a letter / this letter / these
  letters / a number / this number / these numbers / an even number / an
  odd number). Migrated existing nation + current-day-of-week conditions
  from `operator = equals` to `operator = is` since both are predetermined-
  set pickers. Added `exclusive` ("Or" — XOR) match mode (migration
  **0045**). Removed day/counterfeit from the field pill (subject pill only);
  removed slice `opacity-80`. Comparator glyph dispatch (abc / 123 / # /
  abc123) prefixed onto the value input. Input masks: `string`+first/last
  char restricted to 1 char; `digit` to 1 digit; `digit_set` to digits +
  commas + spaces. Changing the comparator type clears the value. Save
  indicator bubbled up to PanelHeader (no layout jump on autosave).
- **Round 4 — match-mode polish.** The And/And-or/Or pill now renders
  between every adjacent pair of conditions (single state, all pills in
  sync). Lowercase labels (`and` / `and/or` / `or`), deeper indent
  (`ml-6`), native `title` hover tooltips explaining each option (sourced
  from `RULE_MATCH_MODE_DESCRIPTIONS` in `src/lib/db/enums.ts`). Hid the
  Next 16 corner dev indicator that flickered between "rendering" /
  "compiling" on every edit (`devIndicators: false` in `next.config.ts`).

### Scope changes from the plan

- **Structured names on `citizens` / `sorting_letters` were de-scoped.** The
  schema had already been restructured on the `citizen-polish` branch
  before this work started — citizens now have separate first/middle/last
  columns natively, and sorting-letter name parts come from the linked
  citizen rather than denormalized on the row. So the planned generated-
  column conversion + `splitName` helper + write-site updates
  (citizens/actions, citizens-editor, sorting/letters/actions,
  `src/lib/names.ts`) were dropped — the rule evaluator picks up the parts
  through the existing column shape unchanged. `RuleContext` does gain the
  six name-part keys (`*_first_name` etc.) as planned.
- **Plan files `0040`/`0041` were renumbered to `0041`/`0042`** because
  origin/main shipped `0040_updated_by_delete_attribution.sql` during the
  branch's lifetime. Subsequent additions extended the chain to `0045`.
- **`condition-description.tsx` was deleted** (the plan said it could stay
  or be restyled) — there was no caller left after the revamp.

### Final verification

- `pnpm typecheck` — clean
- `pnpm lint` — clean on every file touched by this branch (the codebase
  has 49 pre-existing lint errors in unrelated surfaces, untouched)
- `pnpm test` — **527 passing** (96 new tests over the pre-revamp baseline,
  covering name-part targets, the negated operators, letter_set / digit /
  digit_set, nation-is / day-is, `exclusive` XOR for 0/1/2/3 true, and the
  contradiction detector's new pairs).
- DB schema verified live: enum ranges, day_cancelled_id + routes_to_reporting
  columns, position check (`>= 1`), 5 nation rows migrated from
  `equals` to `is` by 0044.
