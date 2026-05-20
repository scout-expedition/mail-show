# Sorting Rules Page — Polish Pass

## Context

A polish pass on `/sorting/rules` (`src/app/(authed)/sorting/rules/`): the rule
pill needs custom per-rule color and a bolder letter, the inspection panel
header should follow the same "summary in the header" pattern used by ending
blocks and morning-report blocks, the previous summary field becomes a notes
textarea, a "Last updated" footer is added, the conditions UI gets two
alignment/hover tweaks, and the "slot N" badge is replaced with a Mailbox +
slot-number twin-square component in both the list row and the panel.

Two new columns (`color_hex`, `notes`) on `sorting_rules` and one new sibling
component (`SlotPill` / `SlotPillSelect`) are needed; everything else is
in-place edits.

## Sequencing landmines

- **Migration must apply before the panel ships** so `select("*")` rows
  actually carry the new columns at runtime. The TS interface is compile-time
  only — column-order between the migration and `types.ts` doesn't matter,
  but neither should land on `main` ahead of the migration.
- **TS types must change before `actions.ts`** widens `patchSortingRule`'s
  patch param.
- **`sorting_rules` already has the `set_updated_at` trigger** (defined in
  `supabase/migrations/0001_init.sql:334`). Patches must NOT include
  `updated_at` — the trigger updates it. We only stamp `updated_by`.
- **`pnpm db:migrate` is broken** in this repo (migration 0020 isn't
  idempotent). Apply the new migration via the Supabase MCP (`apply_migration`).
  Dev DB === prod DB; the migration is purely additive (two nullable columns),
  zero data risk.
- **Realtime fan-out** in `rules-list.tsx:147-186` already does `{ ...r,
  ...newRow }` shallow merge — new columns ride along automatically.

## Step 1 — Migration

**New file:** `supabase/migrations/<timestamp>_sorting_rules_color_and_notes.sql`

Generate the prefix with `pnpm supabase migration new
sorting_rules_color_and_notes`. SQL body:

```sql
alter table public.sorting_rules
  add column if not exists color_hex text,
  add column if not exists notes text;
```

Apply with Supabase MCP `apply_migration` (name:
`sorting_rules_color_and_notes`). No RLS or publication change needed.

## Step 2 — TS type updates

**File:** `src/lib/db/types.ts` — extend `SortingRule` (line 243):

```ts
export interface SortingRule {
  id: string;
  letter: string;
  storage_location: string | null;
  summary: string | null;
  day_implemented_id: string | null;
  day_cancelled_id: string | null;
  destination_slot: number | null;
  routes_to_reporting: boolean;
  match_mode: RuleMatchMode;
  color_hex: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}
```

No change to `page.tsx` — it already does `select("*")`.

## Step 3 — `actions.ts` (widen patch + stamp `updated_by`)

**File:** `src/app/(authed)/sorting/rules/actions.ts` — `patchSortingRule`
(line 125):

1. Widen the `patch` type to include `color_hex: string | null` and
   `notes: string | null`.
2. Fetch the user email at the top (mirroring `deleteRule` at lines 107-114)
   and merge `updated_by` into the update payload.

```ts
export async function patchSortingRule(
  id: string,
  patch: Partial<{
    letter: string;
    storage_location: string | null;
    summary: string | null;
    notes: string | null;
    color_hex: string | null;
    day_implemented_id: string | null;
    day_cancelled_id: string | null;
    destination_slot: number | null;
    routes_to_reporting: boolean;
    match_mode: RuleMatchMode;
  }>
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  const { error } = await supabase
    .from("sorting_rules")
    .update({ ...patch, ...(updatedBy ? { updated_by: updatedBy } : {}) })
    .eq("id", id);
  if (error) {
    if (/unique/i.test(error.message)) {
      throw new Error("That Rule ID is already in use.");
    }
    throw new Error(error.message);
  }
}
```

`updated_at` is auto-managed by the `sorting_rules_set_updated_at` trigger —
do NOT include it.

**Also update `duplicateRule`** (line 42-99) to carry the two new columns in
the clone insert: add `color_hex: source.color_hex, notes: source.notes` to
the insert object at line 63-72. Without this, duplicating a rule silently
drops its color + notes.

**Also update `saveConditions`** (line 157-192) to stamp `updated_by` on the
parent `sorting_rules` row whenever conditions change, so the "Last updated"
footer reflects condition-only edits too. Currently it only writes to the
parent when `matchMode` is provided. Fetch `userData.user?.email` at the top
and always run an `update({ updated_by })` on `sorting_rules` (combined with
the match_mode update when present).

## Step 4 — `rule-pill.tsx` (color prop + bolder letter)

**File:** `src/app/(authed)/sorting/rules/rule-pill.tsx`

- Add `color?: string | null` prop.
- When set, normalize via `normalizeHex()` from `src/lib/color.ts` and apply
  via inline `style={{ color: effective }}` on the SVG (its fill is
  `currentColor`).
- When unset, keep the `text-muted-foreground` class.
- Bump letter weight: `font-bold` → `font-black`.
- Centering already works (`flex items-center justify-center` + symmetric
  diamond SVG); no change required.

Callers needing the new prop:
- `rules-list.tsx:298` — `<RulePill letter={rule.letter} color={rule.color_hex} />`
- `rule-panel.tsx:237` — `<RulePill letter={rule.letter} color={rule.color_hex} className="h-5 w-5" />`

## Step 5 — New `SlotPill` / `SlotPillSelect` component

**New file:** `src/app/(authed)/sorting/rules/slot-pill.tsx`

Two-square pill: left square = `bg-muted` fill with `<Mailbox size={11} />`
from `lucide-react`; right square = outlined, contains the slot number
(`1`–`8`), `R` when `routes_to_reporting` is true, or `—` when both are
nullish. Both squares share a single rounded border with a divider between.

Export two variants:

- **`SlotPill`** — read-only span (used in the list row).
- **`SlotPillSelect`** — wraps the right square with an absolutely positioned
  invisible native `<select>` (same trick as `SelectSegment` at
  `conditions-editor.tsx:186-225`). Options: blank (`—`), `1`–`8`,
  `reporting`. `onChange` returns `{ slot: number | null, reporting: boolean }`.
  **Must accept and forward `onFocus` / `onBlur` to the hidden `<select>`** —
  the panel relies on those to flush autosave and clear presence focus.

## Step 6 — `rules-list.tsx` (list row)

**File:** `src/app/(authed)/sorting/rules/rules-list.tsx` — `RuleListRow`
(line 297):

- Pass `color={rule.color_hex}` to `<RulePill>`.
- Replace the conditional `<Badge variant="muted">…</Badge>` (lines 304-308)
  with `<SlotPill slot={rule.destination_slot} reporting={rule.routes_to_reporting} />`
  (always rendered; the `—` placeholder handles unset).
- Remove the `Badge` import if no other usage remains.

## Step 7 — `rule-panel.tsx` (header summary, color, notes, slot, footer)

**File:** `src/app/(authed)/sorting/rules/rule-panel.tsx`

### 7a — Move summary into the header

Pass an `<input>` as `PanelHeader`'s `title` prop. The header's outer span at
`panel.tsx:98` applies `uppercase tracking-widest text-muted-foreground` to
children **and does NOT have `min-w-0` or `flex-1`**, so a `w-full` input
inside `FieldHighlight` will fight the header for space against the right-side
dirty badge + menu. Wrap the input in a span with `flex-1 min-w-0` to let it
flex and truncate cleanly. Reuse the existing `summaryField` (defined at
line 156-161) — just relocate its rendering. Counter-classes
(`normal-case tracking-normal text-foreground`) override the header's
uppercase/muted styling.

```tsx
<PanelHeader
  title={
    <span className="flex min-w-0 flex-1 items-center">
      <FieldHighlight peers={peers} focusKey={makeFocusKey("summary")}>
        <input
          type="text"
          value={summaryField.value}
          onChange={(e) => summaryField.set(e.target.value)}
          onFocus={summaryField.onFocus}
          onBlur={summaryField.onBlur}
          placeholder="Summary…"
          aria-label="Rule summary"
          className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold normal-case tracking-normal text-foreground placeholder:text-muted-foreground/40 focus:border-border focus:shadow-sm focus:outline-none"
        />
      </FieldHighlight>
    </span>
  }
  icon={<RulePill letter={rule.letter} color={rule.color_hex} className="h-5 w-5" />}
  dirty={panelDirty}
  showSaved={hasBeenDirty && !panelDirty}
  menu={<OverflowMenu items={kebabItems} />}
/>
```

### 7b — Add `notesField`, replace the col-span-12 Summary textarea with Notes

Add alongside the other `useInstantField` calls:

```tsx
const notesField = useInstantField<string>({
  value: rule.notes ?? "",
  onCommit: (v) => patchSortingRule(rule.id, { notes: v.trim() || null }),
  onFocusChange: (f) => setFocus(f ? makeFocusKey("notes") : null),
  onActivity: pingActivity,
});
```

Add `notesField` to the `scalarFields` array (line 167-174). Replace the
col-span-12 Summary block (line 355-366) with a Notes block bound to
`notesField` (`rows={3}`, `<Label>Notes</Label>`).

### 7c — Add Color cell to the scalar grid

Reshape row 1 of the grid to: `Rule ID col-span-3` + `Color col-span-3` +
`Delivery slot col-span-6`. Day rows stay `col-span-6` + `col-span-6`.

Add to imports: `import { normalizeHex } from "@/lib/color";`. Use a
nullable-string `useInstantField` so we can express "no color" cleanly and
keep a way to clear back to null via a small ✕ button beside the swatch:

```tsx
const colorField = useInstantField<string | null>({
  value: rule.color_hex,
  onCommit: (v) =>
    patchSortingRule(rule.id, {
      color_hex: v ? normalizeHex(v) : null,
    }),
  onFocusChange: (f) => setFocus(f ? makeFocusKey("color_hex") : null),
  onActivity: pingActivity,
});

// Picker needs a non-empty hex (browser renders "" as black silently),
// so fall back when nothing is stored. The fallback only feeds the
// native picker — committed value is still `null` until the user picks.
const effectiveColor = colorField.value ?? "#888888";
```

JSX cell — visible swatch + invisible `<input type="color">` + small clear
button when a color is set (mirrors variable-inspector but adds the clear
affordance since rule color is fully optional):

```tsx
<div className="col-span-3 flex flex-col gap-1">
  <Label>Color</Label>
  <FieldHighlight peers={peers} focusKey={makeFocusKey("color_hex")}>
    <div className="flex h-8 items-center gap-1">
      <label
        aria-label="Rule color"
        className="relative inline-flex h-7 w-7 cursor-pointer items-center justify-start"
      >
        <span
          aria-hidden
          className="block h-6 w-6 rounded-sm border border-border/60"
          style={{ backgroundColor: colorField.value ?? "transparent" }}
        />
        <input
          type="color"
          value={effectiveColor}
          onChange={(e) => colorField.set(e.target.value)}
          onFocus={colorField.onFocus}
          onBlur={colorField.onBlur}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      {colorField.value ? (
        <button
          type="button"
          aria-label="Clear color"
          onClick={() => colorField.set(null)}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
        >
          <X size={12} aria-hidden />
        </button>
      ) : null}
    </div>
  </FieldHighlight>
</div>
```

Add `colorField` to the `scalarFields` array so the panel header's
"Unsaved/Saved" badge stays accurate while the picker is open.

### 7d — Replace Delivery slot `<Select>` with `<SlotPillSelect>`

Replace the body of the Delivery slot col-span cell with the new component,
preserving the dirty/saved wiring via the existing `slotField`. Critical:
the current `<Select>` calls `slotField.onFocus` / `slotField.onBlur`
(line 286-287) — `useInstantField.onBlur` flushes dirty edits and clears
presence focus. `SlotPillSelect` MUST forward its `onFocus` / `onBlur` props
to the hidden native `<select>`; the rule-panel call site must pass
`onFocus={slotField.onFocus}` and `onBlur={slotField.onBlur}`, or autosave
and peer focus indicators will silently regress.

```tsx
<SlotPillSelect
  slot={rule.destination_slot}
  reporting={rule.routes_to_reporting}
  onFocus={slotField.onFocus}
  onBlur={slotField.onBlur}
  onChange={({ slot, reporting }) =>
    slotField.set(
      reporting ? "reporting" : slot != null ? String(slot) : ""
    )
  }
/>
```

### 7e — Storage placeholder

Line 349: `placeholder="e.g. Yellow Bin"` → `placeholder="e.g. Bin 3"`.

### 7f — Last updated footer

Add at the bottom of the panel, just before `{confirmDialog}` (line 378).
Copy the `LastUpdatedFooter` implementation from
`src/app/(authed)/inspection/letters/workspace.tsx:6766-6806` inline at the
bottom of `rule-panel.tsx`. It resolves the updater's email to a display name
via `usePresenceContext` (already imported) and renders
`Last updated {formatDistanceToNow(date, { addSuffix: true })} by {name}`.
Add `import { formatDistanceToNow } from "date-fns";`.

```tsx
<LastUpdatedFooter at={rule.updated_at} by={rule.updated_by} />
```

## Step 8 — `conditions-editor.tsx`

**File:** `src/app/(authed)/sorting/rules/conditions-editor.tsx`

### 8a — Delete `X` visible only on hover (and focus-visible)

Wrap the row in `group`. At line 740, the outer wrapper of `ConditionRow`
becomes `group flex flex-col gap-1 rounded-md p-1`. On the delete button
(lines 788-795), add `opacity-0 group-hover:opacity-100
focus-visible:opacity-100 transition-[colors,opacity]`.

### 8b — `+ Condition` button indent

Add `ml-6` to the button at lines 1026-1033, matching the match-mode pill's
`ml-6` (line 1005).

## Step 9 — Verification

Run sequentially:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test -- actions.test` (sanity-check that `patchSortingRule` still
   passes — existing test asserts only `summary, destination_slot`, so the
   `updated_by` merge shouldn't break it).
4. `pnpm dev` — at `http://localhost:3000/sorting/rules`:
   - Pill in list row: letter is visibly bolder.
   - Click a rule. Header shows editable summary input (not `RR-G`); type into
     it → "Unsaved" → "Saved"; list row's truncated summary updates.
   - Color cell opens native OS picker; pick a color → swatch + list-row pill
     + header pill all match. Clear button removes the color.
   - Storage location placeholder reads `e.g. Bin 3`.
   - Notes textarea autosaves; reload page → persists.
   - Click the right square of the slot pill in the panel → dropdown opens
     with `–` / `1–8` / `Reporting`. Pick `Reporting` → right square shows
     `R`. Pick `3` → shows `3`. List row mirrors instantly via realtime.
   - Hover a condition row → `X` fades in; mouse out → fades out. Tab to it →
     it appears (focus-visible).
   - `+ Condition` button's left edge aligns with the and/or match-mode pill's
     left edge (both indented `ml-6` ≈ 24px).
   - Footer at panel bottom reads `Last updated <N> ago by <name>`. Open in a
     second browser as a different user, edit the summary → first browser's
     footer updates within seconds. Edit only conditions → footer still
     updates (verifies the `saveConditions` stamp).
   - Duplicate a rule with a color + notes → clone carries both forward.

## Critical files

- `src/lib/db/types.ts`
- `src/app/(authed)/sorting/rules/actions.ts`
- `src/app/(authed)/sorting/rules/rule-pill.tsx`
- `src/app/(authed)/sorting/rules/slot-pill.tsx` — **new**
- `src/app/(authed)/sorting/rules/rules-list.tsx`
- `src/app/(authed)/sorting/rules/rule-panel.tsx`
- `src/app/(authed)/sorting/rules/conditions-editor.tsx`
- `supabase/migrations/<timestamp>_sorting_rules_color_and_notes.sql` — **new**
