# Implement Endings Frameworks — Phase 1

## Context

The current frameworks editor (`src/app/(authed)/endings/frameworks/workspace.tsx`, ~1500 lines) ties each condition block to a single variable and renders its values as side-by-side columns. This breaks down for real ending writing where paragraphs need to fire on combinations like `SECURITY=LOW AND WORLD_STATUS ≥ 0`. The full redesign is specced in **`docs/endings-frameworks-plan.md`** (read it for the schema, file decomposition, and test slices — this plan does not duplicate that detail).

This pass implements **Phase 1 only**: schema reset to v3, decomposition of `workspace.tsx` into a folder, and the new condition-row + chip authoring surface with **equality-only** matching. Numeric operators, impact-variable refs, the kind picker, collapse chevrons, and overlap detection are explicitly out of scope and tracked for Phases 2/3 of the doc plan.

User-confirmed scope decisions for this pass:
- Phase 1 only (Phases 2/3 are separate sessions).
- Tests ride alongside the code (unit + integration + golden E2E).
- Variables tab gets a **color preview column only** — no kind picker yet.

## Approach

### Schema (`supabase/migrations/0014_endings_v3.sql`)

Drop v2 endings tables and rebuild per `docs/endings-frameworks-plan.md` §Schema. Notes specific to this pass:

- `ending_variables.kind` column ships now (defaults to `'text'`); Phase 1 only writes `'text'`. CHECK accepts both `'text'` and `'number_ref'` so Phase 2 doesn't need a schema bump.
- Operator enum (`'='`, `'≠'`, `'<'`, `'≤'`, `'>'`, `'≥'`) on `ending_condition_row_chips` ships **all six values** in the CHECK. Phase 1 only writes `'='`. Same rationale: avoid a Phase 2 schema migration just to widen the CHECK.
- `color_index int NOT NULL DEFAULT 0` on `ending_variables`; assigned server-side at insert time via `hash(variable.id) % 12`.
- New tables `ending_condition_rows` and `ending_condition_row_chips` follow the existing dynamic-loop RLS pattern from `0009_endings.sql:123–144` (one `for select/insert/update/delete` policy per table, gated by `auth.role() = 'authenticated'`).
- `ending_framework_blocks` has `parent_value_id` removed and `parent_row_id uuid references ending_condition_rows on delete cascade` added; the parent-shape CHECK becomes `(parent_block_id IS NULL AND parent_row_id IS NULL) OR (both NOT NULL)`.

**Read shape stays raw tables** — no flattened view. `page.tsx` zips blocks + rows + chips + variables + values client-side, the same way it zips today. A view buys nothing in Phase 1 and would freeze a JSON shape before the UI is decomposed.

### File decomposition (`src/app/(authed)/endings/frameworks/`)

Target layout (per `docs/endings-frameworks-plan.md` §UI architecture). Each file ≤ ~300 lines:

```
page.tsx                      -- extend fetch to include rows + chips
actions.ts                    -- rewritten for v3: addRow, addChip, removeChip, removeRow, etc.
workspace.tsx                 -- shell only (~150 lines)
framework-list.tsx
framework-editor.tsx
blocks/{block-list,block-row,text-block,condition-block,condition-header,condition-row,chip}.tsx
adders/{root-bottom-adder,empty-row-adder}.tsx
preview-view.tsx
lib/{block-state,drag,color-palette}.ts   -- color-palette goes under src/lib/endings/
```

Two parallel indexers (do not overload one):
- `byParentBlock`: `(parent_block_id, parent_row_id) → BlockState[]` for the block tree.
- `byConditionBlockRows`: `condition_block_id → RowState[] (sorted)` for row ordering inside a condition block.

Cycle guard in drag wiring already exists; rename `parent_value_id → parent_row_id` in its subtree-walker (currently around `workspace.tsx:299`).

`saveFramework` stays UPDATE-only — v3 version runs three parallel UPDATE batches (blocks/rows/chips) inside one `Promise.all`. Creation continues to go through inline server actions.

`createConditionBlock` must auto-seed one empty row; otherwise a freshly-created condition block has no UI surface.

`createVariableInline` sets `kind='text'` and `color_index = hash(id) % 12` server-side.

### Variables editor

Single change: add a small color swatch column in `variables-editor.tsx` reading `color_index` through the shared palette helper. No kind picker, no number_ref UI, no value-list hide/show logic. That all comes in Phase 2.

## Step ordering

Land in this order — each step leaves the tree compiling and tests green:

1. **Migration** `0014_endings_v3.sql`. Apply against local Supabase.
2. **Types + enums.** Update `src/lib/db/types.ts` for the new tables/columns; add `ENDING_CHIP_OPERATORS` and `ENDING_VARIABLE_KINDS` to `src/lib/db/enums.ts` with the full operator set.
3. **TDD: constraint tests** `tests/integration/endings_v3_constraints.test.ts` — exercise the CHECK constraints (chip with text variable but `number_value` set must fail; etc.) against the live migration.
4. **TDD: color palette** `src/lib/endings/color-palette.ts` + `color-palette.test.ts` — deterministic per id, distributes across 12 buckets, stable across renames.
5. **TDD: evaluator** `src/lib/endings/evaluator.ts` + `evaluator.test.ts` — pure function over `(blocks, rows, chips, selections)`. Cases: single-chip equality, AND across chips, first-match-wins, unset variable returns no match, empty condition block, nested condition under a row.
6. **Block-state types** `src/lib/endings/block-state.ts` — extract `BlockState`/`RowState`/`ChipState` types and the two indexers. No behaviour change.
7. **Rewrite `actions.ts`** against v3. New actions for row/chip CRUD; rewrite `createConditionBlock` to seed an empty row; `saveFramework` UPDATE-only across blocks+rows+chips.
8. **`actions.test.ts`** — integration tests per protocol §Mocking (mock `next/cache` only; mock `@/lib/supabase/server` to return a real test client). Assert row shape + UPDATE-only invariant + correct `revalidatePath` calls.
9. **Decompose `workspace.tsx`** in this order (leaves first, recursive containers last): `framework-list` → `framework-editor` shell → `blocks/text-block` → `blocks/condition-header` → `blocks/condition-row` → `blocks/chip` → `blocks/condition-block` → `blocks/block-list` → `blocks/block-row` → `adders/*` → `preview-view`. Drag context lifts to `lib/drag.ts` during this step.
10. **Variables tab color column** — minimal patch to `variables-editor.tsx`.
11. **RLS test extension** in `tests/integration/rls.test.ts`: assert anon client cannot read/write `ending_condition_rows`, `ending_condition_row_chips`.
12. **E2E** `tests/e2e/endings-frameworks.spec.ts` — golden flow: sign in, create framework, add multi-variable text condition with two chips on one row, save, reload, assert chips persist, toggle preview, set both variables to matching values, assert content renders, flip one variable, assert it stops rendering.

After each step: `pnpm typecheck` and the relevant test layer.

## Reused helpers (don't reinvent)

- Panel utilities: `PanelHeader`, `SaveRevert`, `OverflowMenu`, `AutoTextarea`, `Spinner`, `GHOST_FIELD`, `MUTED_ADD_BTN`, `useUnsavedDialog` — `src/components/panel.tsx`
- `useConfirm` — `src/components/confirm-dialog.tsx`
- Variable labels for impact refs (Phase 2 use, but worth pre-importing): `VARIABLE_LABELS` — `src/lib/playthrough/variables.ts:38`
- Server-action test pattern (mock-`next/cache`-only): `src/app/(authed)/inspection/letters/actions.test.ts:1–32`
- Integration test harness + `__INT_TEST__` cleanup: `tests/integration/_helpers.ts:67–74`
- E2E auth setup: `tests/e2e/auth.setup.ts` + `playwright.config.ts:35–48` (already wired)

## Critical files

- `supabase/migrations/0014_endings_v3.sql` — **new**
- `src/lib/db/types.ts` — extend
- `src/lib/db/enums.ts` — extend (operator + kind enums, full operator set)
- `src/lib/endings/color-palette.ts` + `.test.ts` — **new**
- `src/lib/endings/evaluator.ts` + `.test.ts` — **new**
- `src/lib/endings/block-state.ts` — **new**
- `src/app/(authed)/endings/frameworks/page.tsx` — extend fetch
- `src/app/(authed)/endings/frameworks/actions.ts` — rewrite for v3
- `src/app/(authed)/endings/frameworks/actions.test.ts` — **new**
- `src/app/(authed)/endings/frameworks/workspace.tsx` — split + shrink
- `src/app/(authed)/endings/frameworks/{framework-list,framework-editor,preview-view}.tsx` — **new**
- `src/app/(authed)/endings/frameworks/blocks/*.tsx` — **new**
- `src/app/(authed)/endings/frameworks/adders/*.tsx` — **new**
- `src/app/(authed)/endings/frameworks/lib/{drag,block-state}.ts` — **new** (block-state may live under `src/lib/endings/` instead — decide during step 6)
- `src/app/(authed)/endings/variables/variables-editor.tsx` — color swatch column
- `tests/integration/endings_v3_constraints.test.ts` — **new**
- `tests/integration/rls.test.ts` — extend
- `tests/e2e/endings-frameworks.spec.ts` — **new**

## Verification

After all steps land:

1. `pnpm typecheck` clean.
2. `pnpm lint` clean (no new errors vs baseline).
3. Wipe local Supabase, `pnpm db:migrate`, `pnpm test` (unit), `pnpm test:int`, `pnpm test:e2e` — all green.
4. `pnpm dev`, sign in, open `/endings/frameworks`:
   - Create a framework.
   - Add a text variable `PERFORMER` with values `WINTER ROSE` / `SUMMER DAISY`. Add a second text variable `MOOD` with values `CALM` / `STORMY`.
   - Add a condition block. Add two chip slots (one per variable). Add a row with `PERFORMER = WINTER ROSE` AND `MOOD = STORMY` and some text content. Save.
   - Reload — chips and content persist.
   - Toggle preview. Select WINTER ROSE + STORMY → row's content renders. Flip MOOD to CALM → it stops.
   - Add a second row that overlaps with row 1. Confirm first-match-wins (row 1 fires; row 2 does not).
5. Confirm Variables tab shows a color swatch per variable.
6. Confirm the new e2e spec passes.
