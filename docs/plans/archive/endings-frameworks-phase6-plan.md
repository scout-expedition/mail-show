# Endings Frameworks — Phase 6: Header-declared variables

Master plan: `docs/plans/archive/endings-frameworks-plan.md` (Phases 1–3).
Predecessors:
- `phase4` (aggregate kinds, shipped — PR #4)
- `phase5` (static warnings, shipped — PR #5)
- Phase 5 follow-ups: numeric interval gap analysis (PR #6) + numeric row overlap detection (PR #7)

## Context

Today the variable set a condition block branches on is **derived from the chips** on its rows. A row that has no chip on a variable is unconstrained on that variable — the row matches every value. This was the explicit data-model decision in the master plan ("the condition block's variable list is *derived* from the variables referenced by its rows' chips — there is no `ending_condition_block_variables` table").

That model conflicts with the figma authoring intent and surfaces as a usability gap in two places:

1. **Authoring the figma layout.** The mockup's condition block has a header that **declares** the variables it branches on (e.g. `[PERFORMER] [BATHROOMS]`). Each row then carries one chip slot per declared variable. Authors think top-down: pick the variables for the block, then fill in the rows.
2. **Static analysis (Phase 5).** Without an explicit declaration, "uncovered assignments" enumerates over only the variables actually chipped *somewhere in the block*. A row that doesn't chip a variable counts as a wildcard, so it covers more than the author intended. Concrete example: header should be `{Performer, Bathrooms}`, but row 2 has only `Performer = WINTER ROSE` — today's analysis treats the missing Bathrooms slot as wildcard and counts row 2 as covering all 2 Bathrooms values, even though authoring intent says the row should also constrain Bathrooms (or explicitly opt out).

Phase 6 introduces the header-declared model. Once it lands we'll come back to Phase 5's "uncovered" logic and pin it to header-declared variables, which makes the count match author intent.

## Design intent

1. **Block header declares the variable set.** A condition block stores an ordered list of variables. The static analysis enumerates this set.
2. **Rows carry one slot per declared variable.** A slot is either a chip (predicate) or an explicit "any" / wildcard. No third state — every (row, declared_var) pair has one of those two.
3. **Wildcard means "this row is unconstrained on this variable for sure"** — same runtime semantics as today's missing chip, but explicit at authoring time.
4. **Adding a variable to the header propagates to every row** as a new slot, defaulting to wildcard (so adding a header var doesn't accidentally exclude existing rows).
5. **Removing a variable from the header drops every row's slot for it** (chips on that variable are deleted).
6. **Picker: chip targets the slot's variable.** Add-chip from a row's slot is constrained to that slot's variable — no variable picker step. The variable picker only appears in the header (when adding a new declared variable).
7. **Static analysis (post-Phase 6) enumerates header-declared finite-domain variables.** Numeric variables in the header keep the Phase 5 interval-analysis semantics. Aggregate stays as-is.

## Schema

New table `ending_condition_block_variables`:

```sql
create table public.ending_condition_block_variables (
  id uuid primary key default uuid_generate_v4(),
  condition_block_id uuid not null
    references public.ending_framework_blocks(id) on delete cascade,
  variable_id uuid not null
    references public.ending_variables(id) on delete cascade,
  sort_order int not null default 0,
  unique (condition_block_id, variable_id)
);
create index ending_condition_block_variables_block_idx
  on public.ending_condition_block_variables(condition_block_id);

-- Standard updated_at + RLS pattern from earlier endings tables.
```

**Wildcard chip representation.** Two options, decide during implementation:

- **A) Soft.** Keep today's "row has chip XOR row doesn't have chip on this var" model. The header table is the source of truth; missing chips on a declared variable mean wildcard. No schema change to `ending_condition_row_chips`. Simpler migration; slightly looser invariant.
- **B) Hard.** Add an `is_wildcard boolean default false` column to `ending_condition_row_chips`, and mandate that every (row, declared_var) pair has exactly one chip row (wildcard or predicate). Stricter, but a bigger UI lift and more chip rows in the DB.

Recommendation: **A** for v1. The static analyzer derives wildcard from "no chip on declared var in this row" — same logic as today, just driven by the header set. **B** is cleaner long-term but pays for itself only when we need to attach metadata to wildcards (e.g., "wildcard set explicitly by author" vs "default wildcard"); not yet justified.

## Migration

`supabase/migrations/00NN_endings_block_variable_headers.sql`:

1. Create the new table.
2. Backfill: for each existing condition block, insert one row in `ending_condition_block_variables` per distinct `variable_id` referenced by any chip on any of the block's rows. `sort_order` derived from the chip's earliest `sort_order` (deterministic, stable across re-runs).
3. RLS: same `auth.role() = 'authenticated'` policies as the v3 tables.

Idempotent-friendly per project convention (`if not exists` table create; backfill uses `on conflict do nothing`).

## Type + enum updates

- `src/lib/db/types.ts`:
  - New `EndingConditionBlockVariable` interface.
- `src/lib/endings/block-state.ts`:
  - `BlockState` (or a new `ConditionBlockState` extension) gains a `declared_variable_ids: string[]`.
  - Add `buildDeclaredVariablesByBlock(...)` indexer.
- `page.tsx` extends its `Promise.all` to fetch `ending_condition_block_variables`.

## Server actions

`src/app/(authed)/endings/frameworks/actions.ts`:

- `addBlockVariable({ condition_block_id, variable_id })` — adds a header variable; `revalidatePath`. Idempotent on the unique constraint.
- `removeBlockVariable(formData)` — removes a header variable AND deletes chips on that variable for every row in the block (cascade-by-application; we don't put a CASCADE on the block-variable table because the chip→variable FK already exists separately). Single transaction would be ideal; if Supabase JS doesn't support multi-statement transactions, do it as a sequence and accept the brief inconsistency window.
- `createConditionBlock` — when a condition block is created, it has zero declared variables. Adding the first variable is part of authoring.
- `addChip` — keep current shape, but the picker now passes a variable_id chosen from the block's header (UI guarantee, not server enforcement).
- `saveFramework` — extends the per-block batch to also UPDATE `sort_order` on `ending_condition_block_variables`. No insert/delete — adds/removes go through the dedicated actions.

## UI

### Condition block header

`blocks/condition-block.tsx` and a new `blocks/condition-header.tsx`:

```
[chevron] Condition · 2 rows · [PERFORMER] [BATHROOMS] [+ variable]   [trash]
```

- Variable chips on the header carry their auto-assigned color (today's palette/impact rules), no operator/value — they're declarations, not predicates.
- "+ variable" opens the existing variable picker (same shape as today's chip picker variable dropdown — Ending Variables, Impact, Class Affinity, Nation Affinity, Aggregates).
- Click a header variable → opens a small inline menu: "Remove from block" (with confirm if any row has a chip on it).
- Adding a variable to the header **does not** add chips to rows — every existing row gets a new wildcard slot by default.

### Row layout

```
[Performer chip|wildcard] [Bathrooms chip|wildcard]    | content area | trash
```

- One slot per header variable. Order matches header `sort_order`.
- Empty slot reads `(any)` and clicking opens an inline chip picker pinned to that variable.
- Filled slot is today's `ChipPill`.
- Adding a chip via the slot picker: same `addChip` action, with `variable_id` pinned. The variable dropdown is hidden in this flow.
- The current row-level "+ chip" general picker is removed — chip authoring is per-slot now.

### Chip picker

`blocks/chip.tsx` `AddChipButton`:

- Drop the variable dropdown when invoked from a row slot (the variable is already known).
- Keep the dropdown when invoked from the header's "+ variable" — but it picks declarable variables, not chip predicates. Could be a distinct component if cleaner.

### Migration of existing UI flows

- Today's "+ chip" pill on a row that's pre-Phase-6 still exists in DB form (rows with chips, no header). The migration backfills the header from the chips. After the migration, every block has a non-empty header, every row has either a chip or a (newly-implied) wildcard for each declared variable. UI renders accordingly.
- A block with zero declared variables (legitimate edge case: a block that's just been created, before any var added) renders the `(no variables)` empty state with a prominent "+ variable" call to action.

## Static analysis (Phase 5 follow-up)

After Phase 6 lands, `uncoveredAssignmentsByBlock` changes its variable-set source: instead of deriving from the chips, it reads `block.declared_variable_ids`. The enumeration semantics stay the same:

- Finite-domain (text + aggregate) declared variables → cartesian enumeration.
- Single numeric declared variable, no finite vars → interval gap analysis (PR #6).
- Mixed declared (numeric + finite, or multi-numeric) → partial coverage with the existing lower-bound badge.

The user-visible effect: counts match author intent (your "8 - 1 = 7" example from Phase 5).

`staticShadowedRows` (text/aggregate full shadow) and `numericRowOverlaps` (PR #7 — per-row partial overlap + full numeric shadow) both operate per-row, comparing chip predicates pairwise. They don't depend on the variable-set source, so they stay unchanged across the Phase 6 transition.

## Files to add / change

- `supabase/migrations/00NN_endings_block_variable_headers.sql` — **new**
- `src/lib/db/types.ts` — `EndingConditionBlockVariable` interface
- `src/lib/endings/block-state.ts` — `declared_variable_ids` + indexer
- `src/lib/endings/static-analysis.ts` — switch enumeration source from chip union to declared variables
- `src/lib/endings/static-analysis.test.ts` — extend tests to pass declared variables and verify the count semantics
- `src/app/(authed)/endings/frameworks/page.tsx` — extend fetch
- `src/app/(authed)/endings/frameworks/actions.ts` — `addBlockVariable`, `removeBlockVariable`, extended `saveFramework`
- `src/app/(authed)/endings/frameworks/blocks/condition-block.tsx` — header layout + per-slot row layout
- `src/app/(authed)/endings/frameworks/blocks/condition-header.tsx` — **new** (extracted)
- `src/app/(authed)/endings/frameworks/blocks/chip.tsx` — slot-mode picker (variable pre-pinned)
- `src/app/(authed)/endings/frameworks/framework-editor.tsx` — thread declared variables down
- `tests/integration/endings_v3_constraints.test.ts` — RLS + uniqueness on the new table
- `tests/e2e/endings-frameworks.spec.ts` — golden flow: add header variable, fill row slot, save+reload

## Phasing

Land in this order — each step leaves the tree compiling and tests green:

1. **Migration + backfill** — apply against local Supabase; assert row count matches the chip-derived union.
2. **Types + indexer** — extend `block-state.ts`, page fetch, `framework-editor.tsx` plumbing. No UI change yet; declared variables flow through but aren't displayed.
3. **Header UI** — render the declared variables on the condition block header. Add/remove actions go through the new server actions. Existing row UI unchanged (still uses derived-from-chips picker for now).
4. **Per-slot row UI** — replace today's free-form chip picker with one slot per declared variable. Picker becomes pinned-variable.
5. **Static analysis switch** — flip `uncoveredAssignmentsByBlock` to enumerate over declared variables. Update Phase 5 tests.
6. **E2E** — golden spec.

## Verification

After all steps:

- `pnpm typecheck` clean.
- `pnpm lint` baseline unchanged.
- `pnpm test` green; new + updated cases for header-declared enumeration.
- `pnpm test:int` green; new uniqueness/RLS test for `ending_condition_block_variables`.
- `pnpm test:e2e` green; spec covers header-add, header-remove, row slot fill, uncovered-count matches `(declared_text_var_count_product) - matched_assignments`.
- `pnpm dev` walkthrough:
  - Existing frameworks load with backfilled headers; chips and uncovered counts match before/after for already-authored blocks.
  - Adding a header variable with default wildcards leaves coverage unchanged.
  - Removing a header variable purges its chips and updates the uncovered count.
  - Phase 5's "Performer (4 values), Bathrooms (2 values)" example reports `8 - covered = correct` instead of today's chip-derived count.

## Out of scope (followups)

- **Hard wildcard chips (option B above).** Defer until we have a concrete metadata reason.
- **Per-row variable visibility / aliasing.** The header is whole-block; we're not introducing per-row variable scoping.
- **Reordering header variables via drag-drop.** v1 supports `sort_order` in the schema and add/remove; drag-drop is a nice-to-have for v1.5.
- **Tiebreaker semantics for aggregate ties.** Still pending its own plan.
- **Manual color picker.** Still pending.
- **Logic tab migration to chip-row primitive.** Still its own future plan.
- **Autosave / collaborative editing.** Master plan §Followups — separate effort. Phase 6's analysis runs client-side and survives the autosave migration unchanged.
