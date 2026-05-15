# Endings logic editor — result/fallback block design tweaks

## Context

Visual polish for the endings logic editor (`/endings/logic`) — the
**result blocks** and pinned **fallback block** that pick a result from a
dropdown, and the framework **subset picker**. Collected over two review
rounds.

This plan is re-targeted onto current `origin/main` (post the autosave merge,
PR #42). The earlier attempt was built on a stale branch; the result/fallback
blocks are visually unchanged by that refactor (it only swapped manual save
for `useInstantField`/`patchBlock`), so the tweaks re-apply — but the
text-block placeholder now lives in the Lexical editor, and result-block drag
handlers must account for the new `FieldHighlight` wrapper.

Mostly layout/label polish — no schema, server-action, or autosave-mechanism
changes. **One behaviour change** (§E): picking "Random (subset)" no longer
auto-persists a subset; it opens the picker empty and persists on the first
pill. Sentinel **values** are untouched.

## Files to modify

- `src/app/(authed)/endings/_blocks/result-block.tsx`
- `src/app/(authed)/endings/_blocks/fallback-block.tsx`
- `src/app/(authed)/endings/_blocks/lexical/text-block-editor.tsx`
- `src/app/(authed)/endings/logic/logic-editor.tsx`
- **New:** `src/app/(authed)/endings/_blocks/subset-pills.tsx`

## A. Result block — compact height, centred control (`result-block.tsx`)

Today the card is `flex h-full min-h-full flex-1 items-stretch` (line ~203):
it stretches to the full condition-row slot, so a one-line dropdown gets a
tall card with empty space below the select, and it sits taller than a
collapsed condition/text block.

- **Card** (~202-206): drop `h-full min-h-full flex-1`; keep
  `flex items-stretch rounded-md border …`. Card sizes to content.
- **Content padding** (~228): `py-2 pl-2` → `py-1 pl-2`.
- **Select** (~248): `h-8` → `h-7`.
  Result: card border-box ≈ `py-1`(0.5rem) + `h-7`(1.75rem) + 2px border =
  2.25rem + 2px — matching a collapsed condition/text block (`p-2` + `h-5`
  header). The select row is already `flex items-center`, so the `→` arrow +
  dropdown are vertically centred in the now-compact card.
- **Grip span** (~224): `items-start … pt-[17px]` → `items-center`.
- **Overflow-menu wrapper** (~281): `items-start … pt-[12px]` → `items-center`.
  These two drop the hand-tuned top-padding hacks; the kebab now centres in
  the compact card (fixes the round-2 "kebab position doesn't match" — it was
  a side-effect of the height mismatch).
- **Drag handlers** — the card is wrapped by `<FieldHighlight>` (a plain
  `<div>`, no DOM-prop passthrough) inside the outer `<div ref={ref}>`. Once
  the card is compact, the still-stretched wrapper would leave dead drop
  space below it. Move `onDragEnter` / `onDragOver` / `onDrop` from the
  `cardRef` div to the **outer `<div ref={ref}>`** (`relative flex flex-1
  flex-col`, ~171). Keep `cardRef` + the grip's `onDragStart` on the card
  (still the drag image). **Change `nearTarget`** to measure
  `cardRef.current?.getBoundingClientRect()` (fallback to `e.currentTarget`)
  — `e.currentTarget` is now the taller wrapper, so a card-relative rect
  keeps the before/after midpoint where the user sees the card.

This also resolves the round-1 "result blocks butt against the condition-row
divider lines" — a compact card detaches from the `divide-y` rules; the row's
existing `pt-5`/`gap-5` rhythm provides the inset. Verify in-browser.

## B. Fallback block — compact + aligned with result blocks (`fallback-block.tsx`)

The fallback's arrow/dropdown don't line up horizontally with a result
block's, and its grid cell stretches to the helper-text column's height.

- **Middle grid cell** (~126-129): `relative flex items-stretch …` →
  `relative flex items-center self-start …` — stops it stretching to the
  label column; content-height instead.
- **Invisible grip** (~130): `invisible w-2.5 shrink-0` → `invisible w-6
  shrink-0` (mirror a result block's `w-6` drag-handle column).
- **Content** (~133): `py-2` → `py-1 pl-2` — matches a result block's
  `py-1 pl-2`, so the arrow's offset from the card's left edge is identical.
- **Select** (~156): `h-8` → `h-7` (match result block).

## C. Text-block placeholder — more muted (`lexical/text-block-editor.tsx`)

The Lexical body placeholder (~133) is `text-muted-foreground`:
`text-muted-foreground` → `text-muted-foreground/40`. (The summary input in
`text-block.tsx` already uses `placeholder:!text-muted-foreground/40` — this
matches it. Plain `<div>`, so no `!` needed.)

## D. Dropdown labels (`result-block.tsx` `makeResultBlock` + `logic-editor.tsx` `buildFallbackProp`)

Update **both** files (result blocks ~354-389; fallback ~83-128):

- **Nation tiebreak** — rename + reorder to:
  `Random (remaining)` (`RANDOM_REMAINING_SENTINEL`),
  `Random (tied)` (`RANDOM_TIED_SENTINEL`),
  `Random (all)` (`RANDOM_ALL_SENTINEL`).
- **Framework selection** — `Random (any framework)` → `Random (any)`.
- **Subset row** — `Random (custom subset)…` → `Random (subset)`; drop the
  count from the selected-state label. Delete the `subsetSize` /
  `subsetTotal` / `subsetLabel` computation in `result-block.tsx` (~120-129)
  and `fallback-block.tsx` (~85-91); the subset `<option>` reads
  `Random (subset)` in both states.
- **Class affinity** — unchanged (`Random`).

## E. Subset picker → toggle pills (new `subset-pills.tsx`)

`SubsetPicker` (`result-block.tsx` ~427) and `FallbackSubsetPicker`
(`fallback-block.tsx` ~192) are byte-identical checkbox lists. Extract one
shared **`SubsetPills`** component; import from both. Props:
`frameworks: {value,label}[]`, `selectedIds: string[]`, `onToggle`.

`SubsetPills` declares its own `{ value: string; label: string }` prop type;
`ResultOption` and `FallbackOption` are both structurally assignable to it,
so no generic/union is needed at the call sites.

Each framework renders as a `<button type="button" aria-pressed={checked}>`
pill instead of a `<label><input type="checkbox">`:

- Container: `ml-4 flex flex-wrap gap-1.5 rounded-md p-2`, bg
  `var(--block-result-bg)`.
- Pill base: `rounded-full px-2.5 py-1 !text-[11px] uppercase tracking-wide
  transition-colors focus-visible:outline-none focus-visible:ring-2
  focus-visible:ring-ring`.
  - `!text-[11px]` — `globals.css` has unlayered `button { font: inherit }`
    that beats a plain `text-*` utility (same gotcha the summary input
    handles with `!text-[10px]`). 11px reads smaller than the current
    pill yet larger than the 10px condition-chip text.
- **Selected:** `bg-foreground/10 text-foreground ring-1 ring-border` —
  noticeable.
- **Unselected:** `bg-muted/40 text-muted-foreground/50 hover:bg-muted/60
  hover:text-muted-foreground` — gray/muted text.
- **Disabled** (last selected — can't deselect): `cursor-not-allowed
  opacity-60`; keep the `checked && selectedIds.length === 1` guard.
- **Missing-framework** pills: warning-styled (`bg-warning/15
  text-warning-foreground ring-1 ring-warning/40`), `(missing framework: …)`.
- **Preserve** the zero-frameworks branch (`No frameworks available.`).

### Subset defaults to all-off

Picking "Random (subset)" must open the picker with **no pills selected**.
`parseRandomSubset([])` returns `null` (an empty subset isn't representable),
so it can't be persisted empty. Use a local draft flag in both
`result-block.tsx` and `fallback-block.tsx`:

- `const [subsetDraft, setSubsetDraft] = useState(false)`.
- `handleSelectChange`: on `SUBSET_PICKER_VALUE` → `setSubsetDraft(true)`,
  return (do **not** call `resultField.set`). Else → `setSubsetDraft(false)`
  then `resultField.set(next)`.
- `showSubsetPicker = isSubset || subsetDraft` — drives both the `<Select>`
  value (`showSubsetPicker ? SUBSET_PICKER_VALUE : value`) and whether the
  pills render. `selectedIds={subset ?? []}`.
- `toggleSubsetId`: drop **only** the `if (!isSubset) return` guard (it would
  block the first pill in draft mode); **keep** `if (current.size === 0)
  return` — an empty subset can't be persisted, so deselecting the last pill
  must stay blocked. Use `new Set(subset ?? [])`; `setSubsetDraft(false)`
  once it commits the first id via `resultField.set(formatRandomSubset(...))`.
- Gate the empty-state warning ring with `&& !showSubsetPicker`.

## Verification

1. `pnpm typecheck`, `pnpm lint` (changed files clean — pre-existing repo
   lint debt in unrelated files is out of scope).
2. `pnpm dev` → `/endings/logic`:
   - **Framework selection** tab: result blocks compact, `→`+dropdown
     centred, ~same height as a collapsed condition/text block; kebab aligned;
     not butting the row dividers. Dropdown shows `Random (any)` /
     `Random (subset)`.
   - Pick `Random (subset)`: pills render with **nothing selected**; muted
     gray unselected vs. clear selected; ALL-CAPS 11px text; Tab → focus
     ring; Space/Enter toggles; last selected pill can't be deselected.
   - Drag a result block in a tall row — full row slot still accepts the drop.
   - **Fallback block**: compact, not stretched; arrow/dropdown line up
     horizontally with a result block's.
   - **Nation affinity** tab: `Random (remaining)`, `Random (tied)`,
     `Random (all)`.
   - **Text block**: `Paragraph text…` placeholder visibly more muted.
3. Re-pick existing saved subset / random values — only labels changed,
   sentinel values untouched, autosave still commits.

## Known behaviour & limitations

The subset picker keeps its selection in a **local draft** (`subsetDraft`,
`string[] | null` in `result-block.tsx` / `fallback-block.tsx`) so it can sit
at an empty selection — an empty subset cannot be persisted
(`parseRandomSubset([])` returns `null`). Consequences, all **intended**:

- Choosing "Random (subset)" opens the picker empty and persists **nothing**
  until the first framework pill is toggled on. Navigating away first leaves
  the block on its previous saved value.
- Deselecting every pill keeps the picker open with an amber "select at least
  one framework" warning; the persisted value stays at the last valid subset
  until a pill is re-selected. The empty state is in-memory only — it does not
  survive a page reload.
- While a draft is active it is not reconciled with upstream `result_value`
  changes (collaborator edit / `useInstantField` revert) — the draft masks
  them until the next pill toggle. Low-impact collab edge case, tracked in
  [#52](https://github.com/scout-expedition/mail-show/issues/52).
