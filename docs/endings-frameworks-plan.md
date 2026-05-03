# Endings Frameworks Redesign

Mockup: https://www.figma.com/design/AD68eqkgtzsl4pgykdI81Y/Mail-Show-Ending-Frameworks?node-id=1-2

## Context

The current frameworks editor (`src/app/(authed)/endings/frameworks/workspace.tsx`, ~1500 lines) lets authors compose a tree of text + condition blocks where each condition branches on **one variable** and renders its values **side-by-side as columns**. This works for simple endings but breaks down for the actual writing in mail-show:

- Endings need to combine multiple signals at once. The mockup's `SEATSATIONAL` condition reads "if SECURITY is LOW **and** WORLD STATUS ≥ 0, render this paragraph." The current model can't express that without deeply nesting condition blocks, which is unreadable and forces the same paragraph to be duplicated under every value combination.
- Author signals come from two places: (a) hand-defined ending variables (text values like `WINTER ROSE` / `SUMMER DAISY`) and (b) the existing player-impact tally (`world_status`, `demerits`, the four nation affinities, the two class affinities — all numbers). Today only (a) is wired up.
- Numeric impact variables need real comparison operators (≥, <, etc.). Today everything is equality-only.
- The side-by-side value columns don't scale visually beyond ~3 values; the mockup moves to a stacked row layout that scales linearly.
- The current data model encodes "one variable per condition" via `ending_framework_blocks.variable_id`. Going to multi-variable rows requires a schema reset, which the user has approved.

The intended outcome is a frameworks editor whose authoring surface matches the mockup, whose evaluator picks **the first matching row** when multiple AND-row conditions could fire, and whose data model is general enough that the Logic tab can later adopt the same condition-row primitive without another rewrite.

## Design Intent (from the mockup)

1. **Condition rows replace value columns.** A condition block is a header (the variables it branches on) plus a vertical stack of `ConditionTextRow`s. Each row is `[chips for each variable] | [content area]`. Content can be plain text, a nested condition block, or both stacked.
2. **Multi-variable condition blocks.** A single condition block can branch on N variables at once. Each row supplies one chip per variable, and the row matches when **all** chips evaluate true (AND). When several rows match, the first wins; later we'll add overlap-flagging UI but not in this redesign.
3. **Typed variables + operator chips.** Each chip is `[operator] [value]`:
   - Text variables — operators `=` and `≠`, value is one of the variable's named values.
   - Numeric variables (player-impact references) — operators `=`, `≠`, `<`, `≤`, `>`, `≥`, value is a number.
4. **Player-impact variables as first-class options.** The 10 columns in `src/lib/playthrough/variables.ts` (`world_status`, `demerits`, `proletariat`, `gentry`, `epicenter`, `folos`, `emberlyn`, `spokgrad`, `pelico`, `combined_national`) become selectable as "system variables" alongside hand-defined ones.
5. **Block visuals.** No headers on text blocks (already shipped), drag-rail on the left edge (already shipped). Condition blocks gain a collapse chevron (`chevron-down` ↔ `chevron-left`) that hides the rows.
6. **Auto-assigned colors.** Variables get a color via deterministic hash → 12-color palette. No author UI for v1; we'll add a manual picker later if it's worth it.
7. **Adders.** Keep the centered "+ Block" pill at the panel root. Inside a condition block, add a row-level "+" to add another row, a header-level "+" to add another variable to that block, and per-row chip "+" to add another chip slot.
8. **Logic tab is out of scope** for this redesign. It keeps its current rule engine. Once the new condition-row primitive is stable we'll plan that migration separately.

## Schema (drop v2, build v3)

Single new migration `supabase/migrations/0014_endings_v3.sql` that drops the v2 tables and rebuilds. The new shape:

```
ending_variables
  id, name, sort_order
  kind text CHECK in ('text','number_ref')      -- new
  number_ref text NULL                           -- new; set when kind='number_ref',
                                                 --   one of the 10 impact column names
  default_value_id uuid NULL                     -- only meaningful for kind='text'
  color_index int NOT NULL DEFAULT 0             -- new; 0..11, hashed at create time

ending_variable_values                           -- only for kind='text' variables
  id, variable_id, value, sort_order

ending_frameworks                                -- unchanged

ending_framework_blocks
  id, framework_id, parent_block_id, parent_row_id, sort_order
  block_type CHECK in ('text','condition')
  text                                           -- text blocks only

ending_condition_rows                            -- new
  id, condition_block_id, sort_order

ending_condition_row_chips                       -- new
  id, row_id, variable_id
  operator text CHECK in ('=','≠','<','≤','>','≥')
  text_value_id uuid NULL                        -- when variable.kind='text'
  number_value numeric NULL                      -- when variable.kind='number_ref'
  CHECK (
    (variable.kind='text'   AND text_value_id IS NOT NULL AND number_value IS NULL)
    OR (variable.kind='number_ref' AND number_value IS NOT NULL AND text_value_id IS NULL)
  )

-- NB: child blocks now nest under a *row* (parent_row_id), not under a value
-- column. parent_block_id+parent_row_id are both NULL at root, both non-NULL
-- under a row. Same shape constraint as the v2 table.
```

The condition block's variable list is **derived** from the variables referenced by its rows' chips — there is no `ending_condition_block_variables` table. Adding a variable to a block means adding a chip slot to every row; removing one means removing those chips. This avoids a sync bug class.

`saveFramework` stays UPDATE-only for blocks/rows/chips (creation continues to go through inline server actions). Cycle-guard on drag (already in code) carries over.

## UI architecture

Decompose the 1500-line `workspace.tsx` into a folder. Each file ≤ ~300 lines:

```
src/app/(authed)/endings/frameworks/
  page.tsx                       -- unchanged
  actions.ts                     -- rewritten for v3 (text/condition CRUD, row CRUD, chip CRUD, saveFramework)
  workspace.tsx                  -- shell: list panel + editor panel (~150 lines)
  framework-list.tsx             -- left panel (extracted from existing FrameworkList)
  framework-editor.tsx           -- editor shell: name, save, preview toggle, dirty state, drag context
  blocks/
    block-list.tsx               -- recursive list, drag-drop, empty/adder switching
    block-row.tsx                -- dispatches to text-block or condition-block
    text-block.tsx               -- full-bleed textarea + hover grip/menu
    condition-block.tsx          -- header row + collapsible rows
    condition-header.tsx         -- variable chips + add-variable + collapse chevron
    condition-row.tsx            -- chips column + content column (delegates content back to block-list)
    chip.tsx                     -- color-coded variable+operator+value pill, picker
  adders/
    root-bottom-adder.tsx        -- existing collapsible "+ Block" pill, kept as-is
    empty-row-adder.tsx          -- "+" plus-menu when a row's content area is empty
  preview-view.tsx               -- preview pane (rewrite renderParagraphs to walk rows + chips)
  lib/
    block-state.ts               -- BlockState/RowState/ChipState types + by-parent indexes
    drag.ts                      -- dragId/dragHeight context + moveBlock + cycle guard
    color-palette.ts             -- 12-color palette + hash(variable.id) -> index
```

Reused helpers (don't duplicate):
- `useUnsavedDialog`, `useConfirm` — `src/components/confirm-dialog.tsx`, `src/components/unsaved-dialog.tsx`
- `PanelHeader`, `SaveRevert`, `OverflowMenu`, `AutoTextarea`, `Spinner`, `GHOST_FIELD`, `MUTED_ADD_BTN` — `src/components/panel.tsx`
- Variable name labels for impact refs — `VARIABLE_LABELS` in `src/lib/playthrough/variables.ts:38`
- Tally type (for evaluator) — `tallyVariables()` same file, line 17

## Phasing

Ship in three PR-sized phases. Each is independently mergeable and leaves the app in a working state.

### Phase 1 — Schema + skeleton editor (no operators, no impact vars)

- Migration `0014_endings_v3.sql`: drop v2 tables, build v3 with `kind`, `color_index`, rows, chips. `kind` defaults to `'text'`; operator is hard-coded `=` for now.
- Rewrite `actions.ts` against v3.
- Decompose `workspace.tsx` per the layout above. Authoring tree renders condition blocks with stacked rows of equality chips.
- Auto-assign `color_index` on variable create. New `lib/color-palette.ts`.
- Preview rewrites `renderParagraphs` to walk rows + chips with `=`-only matching.
- Variables tab gets minimal updates (column for color preview, no kind picker yet — kind locked to `'text'`).
- E2E spec smoke: open frameworks tab, create a framework, add a multi-variable condition with two text variables, save, reload, assert chips persist. Lives at `tests/e2e/endings-frameworks.spec.ts` and rides the existing storageState wiring.

### Phase 2 — Numeric operators + impact-variable refs

- Variables tab: add a "Kind" picker (Text / Number reference). When Number reference is chosen, expose a select of the 10 impact columns; the variable row stores `kind='number_ref'` + `number_ref='world_status'` etc. Hide the values list for number-ref variables.
- Chip picker grows an operator dropdown; for `kind='number_ref'`, allow `=`, `≠`, `<`, `≤`, `>`, `≥`; for `kind='text'`, allow `=`, `≠`.
- Preview gains a numeric input per number-ref variable (in addition to the value selector for text variables).
- Migration `0015_endings_v3_operators.sql` if extending the operator CHECK (write it as a single migration alongside Phase 2 so prod stays in lockstep).
- E2E updated to also exercise a numeric ref + operator.

### Phase 3 — Polish

- Collapse chevron on condition blocks (UI state, no schema).
- Inline operator/value editing on chips (vs the picker dialog from Phase 2).
- Light overlap-detection in preview: when more than one row would match a given variable assignment, surface a tiny warning badge on the rows that lose to first-match-wins.

Manual color picker, plus any Logic-tab follow-up, are explicitly **not** in this plan and become separate scoped efforts.

## Testing

Tests ride with each phase, in the layers `docs/testing-protocol.md` mandates. Pure logic and server actions are "Always"; the new migration's CHECK constraints qualify as a "Sometimes". One golden E2E covers the surface.

### Phase 1

Unit (vitest, no DB) — colocated `*.test.ts`:

- `src/lib/endings/color-palette.test.ts` — palette assignment is deterministic for a given `variable.id`, distributes across all 12 buckets across many ids, and is stable across renames.
- `src/lib/endings/evaluator.test.ts` — extracts the chip-row evaluator out of `preview-view.tsx` into a pure function so it's testable. Cases: single-chip equality, AND across multiple chips, **first-match-wins** when two rows could fire, unset-variable returns no match (not "fall through"), empty condition block (no rows) yields nothing, nested condition under a row resolves correctly.

Integration (vitest with real local Supabase, follows `tests/integration/README.md`):

- `src/app/(authed)/endings/frameworks/actions.test.ts` — for each new action (`createTextBlock`, `createConditionBlock`, `addRow`, `addChip`, `removeChip`, `removeRow`, `deleteBlock`, `saveFramework`): asserts the row shape inserted/updated, asserts no extra rows are inserted by `saveFramework` (UPDATE-only invariant), and asserts the right paths are passed to `revalidatePath` (mock `next/cache` only, per protocol §Mocking).
- `tests/integration/endings_v3_constraints.test.ts` (new) — exercises the v3 CHECK constraints directly via service-role insert: chip with text variable but `number_value` set must fail; chip with number_ref variable but `text_value_id` set must fail; block with `parent_block_id` set but `parent_row_id` NULL must fail.
- Extend `tests/integration/rls.test.ts` with: anonymous client cannot read or write `ending_condition_rows`, `ending_condition_row_chips`. (Existing patterns cover the other tables.)

E2E (Playwright, rides existing storageState):

- `tests/e2e/endings-frameworks.spec.ts` (new) — golden flow per protocol §Always #6: sign in, create a framework, add a multi-variable text condition with two chips on one row, save, reload, assert the row + chips persist; then toggle preview, set both variables to the matching values, assert the condition's content renders; flip one variable, assert it stops rendering.

### Phase 2

Unit:

- Extend `evaluator.test.ts` with the numeric-operator matrix: `=`, `≠`, `<`, `≤`, `>`, `≥` against representative `world_status` and `gentry` inputs (positive, negative, zero). Borrow the table-driven shape used by `src/lib/rules/evaluate.test.ts` so reviewers see a familiar pattern.

Integration:

- Extend `actions.test.ts` with `kind='number_ref'` paths: creating a number-ref variable populates `number_ref` and clears `default_value_id`; switching a variable from `text` → `number_ref` (if we allow it) deletes its values and any chips referencing it. (Decide in implementation whether to allow this switch — the safe call is to forbid it, but the test pins the behaviour either way.)

E2E:

- Extend `endings-frameworks.spec.ts` with a number_ref variable bound to `world_status` and a row using `≥ 0`; preview by typing a positive number → row fires; negative number → row doesn't.

### Phase 3

Unit:

- `evaluator.test.ts` gains an "overlap detection" set: given a tree, return the rows that would be shadowed by an earlier first-match-wins row for some assignment. Pure, table-driven.

No new integration or E2E for Phase 3 (the additions are UI-state only).

### Out of scope for tests

- Component snapshot tests of the new files. Per protocol §Never.
- Tests that boot a real `next dev` server inside vitest. Per protocol §Never.

## Critical files to change

- `supabase/migrations/0014_endings_v3.sql` (new)
- `src/app/(authed)/endings/frameworks/workspace.tsx` (split, then heavily rewritten)
- `src/app/(authed)/endings/frameworks/actions.ts` (rewrite against v3 schema)
- `src/app/(authed)/endings/variables/variables-editor.tsx` (Phase 2: kind picker, color preview)
- `src/app/(authed)/endings/variables/actions.ts` (Phase 2: handle kind + number_ref + color_index)
- `src/lib/db/types.ts` (regen / hand-update for new tables and views)
- `src/lib/db/enums.ts` (add operator enum + variable kind enum if needed)
- `src/lib/endings/color-palette.ts` + `color-palette.test.ts` (new, Phase 1)
- `src/lib/endings/evaluator.ts` + `evaluator.test.ts` (new, Phase 1; extended in Phases 2 & 3)
- `src/app/(authed)/endings/frameworks/actions.test.ts` (new, Phase 1; extended Phase 2)
- `tests/integration/endings_v3_constraints.test.ts` (new, Phase 1)
- `tests/integration/rls.test.ts` (extend, Phase 1)
- `tests/e2e/endings-frameworks.spec.ts` (new, Phase 1; extended Phase 2)

Read-only references that inform the work:
- Mockup decode + design intent: see this file.
- Existing condition tree shape, drag-drop wiring, save batching: `workspace.tsx:235–650` (state + actions) and `workspace.tsx:670–940` (BlockList/BlockRow tree).
- Player-impact column list + labels: `src/lib/playthrough/variables.ts:3–49`.

## Verification

After Phase 1:
- `pnpm typecheck` clean.
- `pnpm lint` clean (no new errors vs baseline).
- `pnpm db:migrate` against a clean Supabase, then `pnpm test:int` clean.
- `pnpm dev`, sign in, open `/endings/frameworks`, build a framework with one text-only multi-variable condition (e.g. PERFORMER + ANOTHER_VAR), save, reload, confirm tree round-trips. Toggle preview; vary selections; confirm correct paragraph fires and that "first match wins" when two rows could match.
- New e2e spec passes via `pnpm test:e2e`.

After Phase 2:
- Same checks plus: create a `number_ref` variable bound to `world_status`, add a row with `world_status ≥ 0`, preview with the numeric input, confirm the row fires for non-negative inputs and skips for negative.

After Phase 3:
- Manual: collapse a condition block, save, reload — collapse state is UI-only and does not persist (intentional; it's not on the schema).
- Manual: build two rows that overlap on (PERFORMER=WINTER ROSE), confirm the second row gets a warning badge.
