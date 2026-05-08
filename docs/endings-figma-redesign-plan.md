# Endings — Figma redesign

Visual + behavioral redesign of the `/endings/frameworks` and `/endings/logic` editor surfaces. No schema changes, no evaluator changes. The data model from `endings-logic-v2` (chips, rows, condition blocks, header-declared variables, fallbacks, color_hex) is the foundation; this redesign rearranges how those pieces present.

## Source of truth

- Figma file: `AD68eqkgtzsl4pgykdI81Y` ("Mail Show — Ending Frameworks").
- Anchor frame: `1:2` "FrameworkEditor (Mail Show)" — populated state of the framework editor with several condition blocks at varying complexity.
- The file currently contains **only** the framework editor, populated state. Logic tab, empty state, picker overlays, and hover/drag/menu states are not yet designed (see "Open design comps" below).

## What's changing (visible in `1:2`)

### Layout

Today's `condition-block.tsx` renders chips inline within each row. The new design swaps to a **per-row grid**:

- Variables declared on the condition block live in a header strip, each as a colored chip (`PERFORMER`, `SECURITY`, `WORLD STATUS`, `CLASS AFFINITY`, …).
- Each row beneath that header is a grid: one column per declared variable (chips for that row+variable stack vertically inside), and a final right column for the row's prose / result / nested-condition content.
- A `+` affordance lives at the bottom of each variable column on the row, replacing today's "+ chip" button that floats inline.

The chip-row primitive itself is unchanged — chips still belong to rows, just bucketed visually by `variable_id`. No migration.

### Chip chrome

- Chip pill drops the variable name (slot mode is now the only mode) and renders just `[operator] [value]` with the variable's `color_hex` as the border + tinted fill. Today's full-name chip survives only as the header variable chip.
- Color comes straight from `ending_variables.color_hex` (added in 0029); falls back to `paletteColor(color_index)` when null. The redesign makes this colour visible everywhere a variable's chip appears.

### Multi-variable condition headers

- A condition block with multiple declared variables shows them side-by-side in the header, each with its own `+` (e.g. SEATSATIONAL = SECURITY + WORLD STATUS). The header chip doubles as the column anchor for the row grid.

### Collapse states

The Figma file ships three explicit nested-block states:

1. **Default** — everything expanded.
2. **Inside Collapse** — parent block is collapsed but the inner child still renders (read as: expand-while-pinned-to-folded-parent).
3. **Total Collapse** — everything folded down to its variable header.

Today's `ConditionBlock` only has a single per-block collapse. Phase 4 adds the second level.

### Panel chrome

- Header reads `FRAMEWORK / SAVED ✎ ⨯` — passive "Saved" indicator + an edit icon and a close affordance.
- This implies a different save UX than today's explicit Save / Revert buttons. **Decision needed** before Phase 5 (see open question 1).

### What stays

- Editor surfaces still hang off `_shared/document-editor.tsx`; the redesign rewrites the visual block components, not the editor shell.
- Block tree shape, drag-drop semantics, server actions, and the evaluator are untouched.
- Variables editor (`/endings/variables`) keeps its current chrome — redesigned in a later round.

## Implementation phases

Each phase is its own commit, leaving `pnpm typecheck` + `pnpm test` green. Visual phases also leave the dev server flow walkable.

1. **Token + color audit.** Pull design tokens from the Figma frame (background levels, chip fills/borders, radii, spacing scale) and compare against the existing Tailwind tokens. Any missing tokens get added; any one-off hex values get pulled into `tailwind.config.ts`. Output: a short tokens table appended to this plan.

2. **Chip pill chrome.** Rebuild `_blocks/chip.tsx`'s `ChipPill` to render compact `[op] [value]` with `color_hex` driving the border + tint. The non-slot ("variable name visible") variant survives only for the header strip — gate it on a `variant: "header" | "slot"` prop. Hover/menu pop visuals match Figma (overflow `︙` reveal on row hover).

3. **Row grid layout.** Restructure the row inside `_blocks/condition-block.tsx` (and its `ConditionRow` helper) to a CSS grid: `N` variable columns + `1fr` prose. Chips for each row+variable bucket stack vertically inside their column; "+ chip" lives at the bottom of each cell. Right column hosts the existing recursive child-block list (text, result, nested condition). Test: render a condition with 1, 2, and 3 declared variables.

4. **Multi-variable condition headers.** Variable chips render side-by-side at the top of the block, each with an inline `+` (already exists, just restyled). Compound headers like SEATSATIONAL render as a stack of chips with subdivision dividers if Figma calls for them.

5. **Two-level collapse.** Add the parent/total collapse pair. The "total" toggle lives at the panel level (`FrameworkEditor` chrome) and folds every condition block to its header. The per-block toggle stays as today. Persist the panel-level state in `localStorage` so it survives reload.

6. **Panel header redesign.** Update `PanelHeader` (or a Frameworks-specific override) to match the Figma `FRAMEWORK / SAVED ✎ ⨯` layout. Save UX decision (open question 1) lands here.

7. **Apply to `/endings/logic`.** All three logic tabs (Ending / Class Tiebreak / Nation Tiebreak) reuse `_blocks/` so the redesign carries over for free. Result-block leaves swap into the right column. Verify all four logic doc kinds render correctly.

8. **Verification pass.**
   - Side-by-side screenshots of every redesigned surface vs. Figma comp at the same viewport.
   - Walkthrough each authoring flow in the dev server: create framework, add condition, add multi-var condition, add nested condition, save, reload, preview.
   - Walkthrough each logic-doc flow: ending framework rule, class tiebreak row, nation tiebreak row with `__remove__:` + `__random_remaining__`.
   - `pnpm typecheck` + `pnpm test` + `pnpm test:int` (if local Supabase is up).

## Open design comps (not in `1:2`, request before the matching phase)

These are flagged as "not designed yet" — implementation paces against them.

1. **Save UX.** Is the new "Saved" indicator passive (autosave on every keystroke) or a different presentation of today's explicit save flow? Autosave is a separate large effort (`docs/endings-frameworks-plan.md` Followups). Default for now: keep today's behavior, just restyle the indicator.
2. **Empty state** — no framework selected on the Frameworks workspace.
3. **Picker overlays** — chip-add picker, header `+ var` picker, inline "+ New variable…", "+ New value…", framework_selection custom-subset checkbox grid.
4. **Random reroll affordance** — Dice5 button styling and "rolled from N options" copy treatment.
5. **Hypothetical tied set picker** (`/endings/logic` Nation Tiebreak preview).
6. **Tiebreak indicator panel** above framework paragraphs ("X aggregate ties resolved by tiebreak"), and the per-key reroll button inside it.
7. **Hover / drag / overflow-menu open states** — many `OverflowMenu` and `More Menu` instances render `hidden="true"` in the metadata; need on-state comps.

For each, default behavior is **keep current chrome until comps land**. Implementation phases above don't block on these.

## Out of scope this round

- Variables editor (`/endings/variables`) — keeps its current chrome.
- Inspection letters, narrative graph.
- Schema migrations and evaluator changes.
- Step 5 (runtime `evaluateEnding` / playthrough wiring) and Step 6 (E2E rewrite) from `docs/endings-logic-v2-plan.md`. These ride independently.

## Verification checklist

- [ ] Tokens + colors documented in this plan after Phase 1.
- [ ] Each phase ships green typecheck + tests.
- [ ] Each phase lands a side-by-side screenshot in the PR description.
- [ ] No file in `src/lib/endings/` or `supabase/migrations/` modified.
- [ ] No regressions in inline create flows ("+ New variable…", "+ New value…") — they keep working with current chrome until phase 7's overlay redesign lands.

## Phase 1 — token + color audit (2026-05-08)

Sampled three sublayers from frame `1:2` for styled output: `1:3` PanelHeader, `12:1270` ConditionBlock (single-variable), `12:1649` ConditionBlock (multi-variable SEATSATIONAL with SECURITY + WORLD STATUS). The Figma file uses inline hex values — there are no Figma variables defined — so this audit rolls them into our existing CSS-variable token system.

### Tokens already present (no change)

These map exactly to current tokens in `src/app/globals.css`:

| Figma value | Current token | Used in |
| --- | --- | --- |
| `#2c323b` | `--border` | PanelHeader border-bottom; matches existing UI border. |
| `#8b93a1` | `--muted-foreground` | "FRAMEWORK" panel-header label text. |
| `rgba(139,147,161,0.7)` | `--muted-foreground` @ 70% alpha | "Saved" indicator (inline alpha — no new token). |

### New tokens to add

These are repeated across the frame and earn a name. I'll add them in `globals.css`, scoped under the existing dark theme block. Light mode is out of scope for this project.

| New token | Hex | Role |
| --- | --- | --- |
| `--block-card` | `#21252b` | Condition block fill — sits between `--card` (#181c22) and `--accent` (#242b36). The redesign uses this specifically for condition-block chrome; regular cards (`--card`) keep their value. |
| `--block-border` | `#606771` | Condition block border + dashed `+` adders. Lighter than `--border` so blocks visually separate from the panel without competing with text. |
| `--block-result-bg` | `#000000` | ResultsBlock fill (the black panel that holds rows inside a condition block) and the innermost TextBlock fill. Pure black is intentional — the design uses it as the deepest layer. |
| `--block-text-card` | `#474a4d` | Outer chrome around a TextBlock when it sits inside a ResultsBlock. Mid-gray to lift prose off the black base. |
| `--row-cell-bg` | `#0c0e12` | ConditionLabel cell background (the dark pill on the left of each row holding `[op] [value]`). One step below `--background` (#0b0d10). |

Notes:

- The white-04 panel-header overlay (`rgba(255,255,255,0.04)`) is rendered inline rather than tokenized — only one usage in the frame, no need for a name.
- Pure black `#000000` already shows up as `bg-black` via Tailwind defaults, but I'm naming it `--block-result-bg` so the redesign code reads as "the result-block layer" rather than relying on incidental black usage.

### Per-variable chip color

Confirmed: chip / operator-icon / condition-label border all inherit the **variable's** `color_hex`. The Figma frame demonstrates this with three concrete variables:

| Variable | Figma color | Notes |
| --- | --- | --- |
| `PERFORMER` | `#00bfff` (Deep Sky Blue) | Used as Variable chip bg, ConditionLabel left-border, and Operator icon bg on every row keyed to PERFORMER. |
| `SECURITY` | `#ff7700` (`#f70` shorthand — orange) | Same plumbing on rows keyed to SECURITY. |
| `WORLD STATUS` | `#ff00dd` (`#f0d` shorthand — magenta) | Same plumbing on rows keyed to WORLD STATUS. |

These hexes are placeholders the designer picked for legibility — the runtime read picks them up via `ending_variables.color_hex` (added in 0029) with a fallback to `paletteColor(color_index)`. No DB seeding needed.

### Spacing scale

Figma uses px values that round to 0.25rem multiples at the project's 13px root (so `0.375rem = 4.875px`, `0.75rem = 9.75px`, `1rem = 13px`, `1.5rem = 19.5px`). All values fit cleanly into Tailwind's existing `[1.5,1,0.75,0.5,0.25]rem` scale. **No new spacing tokens.**

Recurring values:

- Block card padding: `6px 2px` (`py-1.5 px-0.5`).
- ResultsBlock padding: `8px` (`p-2`) or `8px / 16px` (`px-2 py-4`) for outer-chrome variants.
- Inter-row gap inside ResultsBlock: `12px` (`gap-3`).
- Row chip stack gap: `2px` — needs a one-off `gap-[2px]` (or `gap-px` doubled) since Tailwind's smallest is `4px`.
- ConditionLabel width: `120px` (`w-30`).
- Variable chip height: `16px` — the fixed pill height across the design.

### Border radii

Effectively a single radius: `4.88px` (`0.375rem`). Maps to Tailwind `rounded-md`. No new radius tokens.

The PanelHeader uses `rounded-tl-md rounded-tr-md` to match the panel's outer chrome. The Variable chip and ConditionLabel use full `rounded-md`. The ConditionLabel is half-rounded (`rounded-l-md`) when it abuts a TextBlock, full-rounded when it stands alone with a `+` next to it.

### Typography

All JetBrains Mono. The current globals.css declares `--font-mono` already; we already use it as the body default. Sizes:

| Role | Figma | Tailwind (at 13px root) |
| --- | --- | --- |
| Panel header title ("FRAMEWORK") | JBM Medium 9.75px / 13px leading / 0.075rem tracking, uppercase | `text-[0.75rem] font-medium tracking-widest uppercase` (existing pattern) |
| "Saved" indicator | JBM Regular 10px / 15px leading / 0.077rem tracking, uppercase | `text-[10px] font-mono uppercase tracking-widest opacity-70` |
| Variable chip / operator icon / value pill | JBM Regular 10px / 15px leading / 0.019rem tracking, uppercase, white | `text-[10px] font-mono uppercase tracking-wider text-white` |
| Prose / TextBlock body | JBM Regular 12–13px / 15–19.5px leading, white | `text-sm font-mono` (existing) |

### Open question for Phase 2+

The redesign reuses `bg-black` (and tokenizes it as `--block-result-bg`) for the inner TextBlock. Today's editor uses `--card` / `--background` exclusively. **Confirm before Phase 2** that pure-black inner panels are intended; this is a meaningful contrast bump from the current chrome.

Default plan: take the Figma palette literally — implement with `--block-result-bg = #000000`. If you want to soften it, swap to `--background` (#0b0d10) before Phase 2 lands.

## Followups (post-redesign)

- **Variables editor** redesign pass (out of scope today).
- **Picker overlay redesign** (open comp 3) — own phase after comps land.
- **Hypothetical tied set + reroll affordance redesign** (open comps 4–6) — own phase after comps land.
- **Save UX → autosave** (open comp 1) — separate effort if the answer is "autosave".
