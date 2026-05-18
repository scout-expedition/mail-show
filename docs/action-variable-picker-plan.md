# Action variable picker → autocomplete component

Branch: `corey/action-variable-picker`

## Goal

Replace the actions-menu "+ add ending variable" dropdown with a searchable
autocomplete that mirrors the ending-frameworks text-block variable-tag
autocomplete: a type-to-filter input plus kind-grouped result rows
(color-square + name + uppercase kind label, dividers between kind groups).

## Current state

**Component A — target look** (`src/app/(authed)/endings/_blocks/mention-autocomplete.tsx`)
- `filterVariablesForMention(variables: VariableState[], query)` — case-insensitive,
  kind-grouped (`text → number_ref → aggregate_ref`), prefix-before-substring sort,
  flat array out. Covered by `mention-autocomplete.test.ts`.
- `MentionAutocompletePopup` — plain React `<ul role="listbox">`, **not** Lexical-coupled.
  Each `<li role="option">` = 2×2 color square + truncated name + uppercase kind
  label; dividers where adjacent kinds differ; `position: fixed`; "No matching
  variables." empty state. Props: `filtered` / `activeIndex` / `onChangeActiveIndex`
  / `onCommit` / `position`.
- The `@` trigger lives separately in `lexical/mention-trigger-plugin.tsx` — **not reused**.
- Importers of the module: `mention-trigger-plugin.tsx`, `mention-autocomplete.test.ts`.

**Component B — to change** (`AddEndingVariableMenu`, `inspection/letters/workspace.tsx` ~5427-5556)
- `+` button (`h-5 w-10`, dashed) opens an `absolute top-full` `<div role="listbox">`.
- Lists pre-filtered `availableVariables` (assigned ones already excluded by
  `EndingAssignmentsSection`). No search. Rows = name in the variable's color, no
  color-square, no kind label, no grouping.
- Keyboard handled on the `+` button: Enter/Space/↓ open; ↑/↓/Home/End move;
  Enter/Space commit; Esc close.
- `disabled` when no variables exist or all are assigned.

## Key constraint — type mismatch

`filterVariablesForMention` / the popup are typed for `VariableState`
(`lib/endings/block-state.ts`); the actions menu has `EndingVariable`
(`lib/db/types.ts`). They share `id / name / kind (EndingVariableKind) /
color_index / color_hex`, but `aggregate_ref` differs (`AggregateRef | null`
vs `string | null`) — so `EndingVariable` is **not** assignable to
`VariableState`.

→ Introduce a minimal structural interface and make the shared helpers generic
over it:

```ts
interface VariableLike {
  id: string;
  name: string;
  kind: EndingVariableKind;
  color_index: number;
  color_hex: string | null;
}
```

Both `VariableState` and `EndingVariable` satisfy it without casts. Scope this
interface **strictly to filtering + row rendering** — it is not a shared
variable model and must not grow to imply `default_value_id`, `sort_order`, or
the ref fields exist.

## Approach

### 1. Extract a narrow shared module

Create `src/components/variable-picker/`:
- `variable-filter.ts` — `VariableLike`, `KIND_ORDER`, `KIND_LABEL`, and a
  generic `filterVariables<T extends VariableLike>(variables, query)` (today's
  `filterVariablesForMention` body, logic unchanged).
- `variable-option-list.tsx` — `VariableOptionList<T extends VariableLike>`: the
  `<ul role="listbox">` rows only — color square + name + kind label + group
  dividers + `activeIndex` highlight + `scrollIntoView`. **Presentational
  primitive only.** It does not own popup lifecycle, open/close, positioning, or
  keyboard policy — the two callers have meaningfully different interaction
  models and must keep that logic themselves.

### 2. Rewire Component A onto the shared module

- `mention-autocomplete.tsx` keeps `detectMentionTrigger` (mention-specific) and
  `MentionAutocompletePopup`; the popup now wraps `VariableOptionList` and only
  adds the `position: fixed` caret coords + empty state.
- **Preserve the existing export surface**: keep `filterVariablesForMention` and
  `MentionAutocompletePopup` exported with the same names and prop shapes (re-export
  `filterVariablesForMention = filterVariables` is fine). `mention-trigger-plugin.tsx`
  imports those exact symbols and its file comments document the contract; the
  Lexical tests focus on mention-node behavior and won't catch a popup-semantics
  regression.
- `mention-autocomplete.test.ts` — logic unchanged, tests stay green. Optionally
  add a focused test for `filterVariables` alongside `variable-filter.ts`.

### 3. Rebuild `AddEndingVariableMenu` as an autocomplete

- Keep the `+` trigger button (same dashed `h-5 w-10` style, same
  `disabled` / `disabledReason`).
- On open, render a popup containing:
  - An autofocused search `<input>`, styled for the dark control-room. Note:
    `globals.css` has `input { font: inherit }`, which silently beats
    `text-[Npx]` — use a `!` prefix if a smaller font is needed (root font is 13px).
  - `VariableOptionList` fed `filterVariables(availableVariables, query)`.
  - "No matching variables." empty state when the query matches nothing.
- **Keyboard / focus ownership (define explicitly):** the search input is the
  one new tab stop and owns all keys — typing filters; ↑/↓ move `activeIndex`
  (clamp, don't wrap into the input); Enter commits the active row → `onPick`;
  Esc closes the popup and returns focus to the `+` button. Outside-click
  (mousedown listener) closes without committing. Options stay `tabIndex={-1}`,
  mouse-hover-to-highlight, click-to-commit — consistent with the just-merged
  action-inspector PR conventions.
- After a pick: close the popup (current behavior); `availableVariables` shrinks
  via the normal local-state append in `addWithVariable`.

### 4. Positioning — `fixed` from the button rect, with lifecycle handling

Use `position: fixed` computed from the `+` button's `getBoundingClientRect()`
(mirrors Component A). This escapes the 5-panel-slide `overflow` clipping — the
neighbouring `AddActionMenu` flyout opens upward specifically because downward
`absolute` flyouts get clipped by that overflow.

**`getBoundingClientRect()` is viewport-relative and goes stale.** Unlike the
mention popup (re-anchored on every Lexical editor update), this menu gets
nothing for free. While the popup is open:
- Recompute the anchor coords on `scroll` (capture phase) and `resize`, **or**
  simply close the popup on those events.
- The popup must survive / track panel-slide transitions and the `forceNarrow`
  graph embed — closing on layout movement is the safe default; verify in-browser.
- Set the `z-index` intentionally: neighbouring action menus in `workspace.tsx`
  use `z-30` / `z-40`, higher than the current ending-variable menu's `z-20`.
  Pick a value that sits above sibling menus without escaping the app shell.

### 5. Out of scope

- `ActionVariableChip`'s per-chip value `<select>` — untouched; this task is the
  variable *picker* only.
- The `@`-in-Lexical trigger — not reused; the actions menu stays `+`-triggered.

## Files touched

- NEW `src/components/variable-picker/variable-filter.ts`
- NEW `src/components/variable-picker/variable-option-list.tsx`
- `endings/_blocks/mention-autocomplete.tsx` — wrap shared list; keep export surface.
- `endings/_blocks/lexical/mention-trigger-plugin.tsx` — update import path only.
- `endings/_blocks/mention-autocomplete.test.ts` — update import path; logic unchanged.
- `inspection/letters/workspace.tsx` — rewrite `AddEndingVariableMenu`.

## Risks / verify

- **(blocker-class)** Fixed-position popup detaching from the `+` button on
  scroll / resize / panel-slide / realtime reconciliation that moves the button.
  Handle via recompute-or-close (see §4).
- Popup clipping or detachment inside the `forceNarrow` graph embed — verify both
  `/inspection/letters` standalone and the `/graph` inline embed.
- Focus/blur subtlety from the new autofocused input vs. the outside-click
  listener — make sure committing via mouse doesn't race the blur close.
- `pnpm typecheck` + `pnpm lint` + the existing `mention-autocomplete` test suite
  must stay green.

## Testing

- `pnpm typecheck`, `pnpm lint`.
- Run `mention-autocomplete.test.ts`; add a `filterVariables` test if renamed.
- In-browser: `/inspection/letters` → select an action → open the variable
  picker → type to filter → ↑/↓/Enter/Esc → pick a variable → confirm the chip
  appears. Repeat in the `/graph` inline `forceNarrow` embed. Scroll the panel
  while the popup is open and confirm it tracks or closes cleanly.
