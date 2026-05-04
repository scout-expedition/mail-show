# Endings Frameworks — Phase 4: Aggregate variable kinds

Master plan: `docs/endings-frameworks-plan.md` (Phases 1–3).
Predecessor branch / PR: `endings-v3-phase-3` (collapse, overlap-in-preview, drag fixes).

## Context

Phases 1–3 give authors `text` and `number_ref` variables. The actual writing surface needs more: a paragraph often hinges on **which** class or nation is currently winning, not on a specific score. Asking authors to encode that with raw numeric chips on each of `proletariat` / `gentry` / `folos` / `emberlyn` / etc. doesn't scale and doesn't read.

This phase adds a third variable kind — `aggregate_ref` — that picks the argmax/argmin of a fixed score set:

- **Class Affinity** — argmax/argmin over `{proletariat, gentry}`.
- **Nation Affinity** — argmax/argmin over `{folos, emberlyn, spokgrad, pelico, epicenter}`. (Epicenter is in this set per the user spec; if we later decide to exclude it for symmetry with `combined_national`, that's a one-line config change.)

Authoring shape: `[Class Affinity] [top is] [Working Class]` matches when working_class > gentry. Tiebreaker semantics are explicitly **TBD** — for now, ties produce no match. A future plan will define tiebreakers.

## Schema (new migration `0021_endings_aggregate.sql`)

Single migration, idempotent-friendly per the project convention:

```sql
-- 1) Variables grow an aggregate_ref column + widened kind CHECK.
alter table ending_variables
  add column if not exists aggregate_ref text;

alter table ending_variables
  drop constraint if exists ending_variables_kind_check;
alter table ending_variables
  add  constraint ending_variables_kind_check
       check (kind in ('text','number_ref','aggregate_ref'));

alter table ending_variables
  add  constraint ending_variables_aggregate_ref_check
       check (
         (kind = 'aggregate_ref'  and aggregate_ref in ('class_affinity','nation_affinity'))
         or (kind <> 'aggregate_ref' and aggregate_ref is null)
       );

-- 2) Chips grow an aggregate_value column + widened operator CHECK.
alter table ending_condition_row_chips
  add column if not exists aggregate_value text;

alter table ending_condition_row_chips
  drop constraint if exists ending_condition_row_chips_operator_check;
alter table ending_condition_row_chips
  add  constraint ending_condition_row_chips_operator_check
       check (operator in ('=','≠','<','≤','>','≥','top=','top≠','bottom=','bottom≠'));

-- 3) Tighten the value-shape CHECK so each chip carries exactly the right
--    payload for its variable's kind. Replaces the existing CHECK.
alter table ending_condition_row_chips
  drop constraint if exists ending_condition_row_chips_value_shape_check;
alter table ending_condition_row_chips
  add  constraint ending_condition_row_chips_value_shape_check
       check (
            (text_value_id    is not null and number_value is null     and aggregate_value is null)
         or (number_value     is not null and text_value_id is null    and aggregate_value is null)
         or (aggregate_value  is not null and text_value_id is null    and number_value is null)
       );

-- 4) Auto-seed two aggregate variables (deterministic uuid_v5 like 0016).
--    Names: "Class Affinity", "Nation Affinity". sort_order placed below
--    the existing impact seeds.
insert into ending_variables (id, name, kind, aggregate_ref, sort_order, color_index)
values
  (uuid_generate_v5('00000000-0000-0000-0000-000000000000', 'class_affinity'),
   'Class Affinity', 'aggregate_ref', 'class_affinity', 1100, 0),
  (uuid_generate_v5('00000000-0000-0000-0000-000000000000', 'nation_affinity'),
   'Nation Affinity', 'aggregate_ref', 'nation_affinity', 1101, 0)
on conflict (name) do nothing;
```

Notes:
- New operators are `top=` / `top≠` / `bottom=` / `bottom≠`. Single-token strings keep the `operator` column simple (no separate "side" column to JOIN against). Render labels in the UI as "top is" / "top is not" / "bottom is" / "bottom is not".
- `aggregate_value` is a free text column. Allowed values are validated client-side against the seeded class/nation column names. We deliberately don't FK it to anything — those are not row identifiers; they're the impact-column names from `src/lib/playthrough/variables.ts`.
- Cleanup pass (analogous to 0016): if user-defined `kind='aggregate_ref'` rows somehow exist with names other than the seeds, leave them alone. Users can't create aggregate variables through the UI; the seeds are the only path.

## Type + enum updates

- `src/lib/db/enums.ts`:
  - Extend `ENDING_VARIABLE_KINDS` with `'aggregate_ref'`.
  - Extend `ENDING_CHIP_OPERATORS` with the four new operators.
  - Extend `ENDING_OPERATORS_BY_KIND` with `aggregate_ref: ['top=','top≠','bottom=','bottom≠']`.
  - Add `AGGREGATE_REFS = ['class_affinity','nation_affinity'] as const`.
  - Add `AGGREGATE_OPTIONS_BY_REF` mapping `class_affinity → ['proletariat','gentry']` and `nation_affinity → ['folos','emberlyn','spokgrad','pelico','epicenter']`.
  - Optional `AGGREGATE_OPERATOR_LABELS` for "top is" / "top is not" / "bottom is" / "bottom is not".

- `src/lib/db/types.ts`: `ending_variables.aggregate_ref` and `ending_condition_row_chips.aggregate_value` columns added.

- `src/lib/endings/block-state.ts`:
  - `VariableState.aggregate_ref: string | null`.
  - `ChipState.aggregate_value: string | null`.

## Evaluator (`src/lib/endings/evaluator.ts`)

- `EvalVariable` grows `aggregate_ref: string | null`.
- `EvalChip` grows `aggregate_value: string | null`.
- `EvalInputs` grows `numberRefByName: Map<string, string>` — maps each impact column name (e.g. `'gentry'`) to the variable_id of the seeded number_ref variable. The evaluator uses this to look the underlying scores out of the existing `selections.numbers` map without leaking variable identity into chip rows.

`evaluateChip` gains an `aggregate_ref` branch:

```ts
if (variable.kind === 'aggregate_ref') {
  const ref = variable.aggregate_ref!;             // 'class_affinity' | 'nation_affinity'
  const cols = AGGREGATE_OPTIONS_BY_REF[ref];      // e.g. ['proletariat','gentry']
  const vals = cols.map((col) => {
    const vid = numberRefByName.get(col);
    return vid != null ? selections.numbers[vid] : null;
  });
  if (vals.some((v) => v == null)) return false;   // any unset → no match (no fall-through)
  if (chip.aggregate_value == null) return false;
  const max = Math.max(...vals as number[]);
  const min = Math.min(...vals as number[]);
  const isTie =
    (chip.operator.startsWith('top')    && vals.filter((v) => v === max).length > 1) ||
    (chip.operator.startsWith('bottom') && vals.filter((v) => v === min).length > 1);
  if (isTie) return false;                          // tiebreaker TBD; no match for now
  const winnerCol = chip.operator.startsWith('top')
    ? cols[vals.indexOf(max)]
    : cols[vals.indexOf(min)];
  const isEqual = winnerCol === chip.aggregate_value;
  return chip.operator.endsWith('=') ? isEqual : !isEqual;
}
```

Properties verified by tests:
- 5 vs 2 (working class wins): `top= proletariat` → true; `top= gentry` → false; `top≠ gentry` → true.
- Symmetric on bottom.
- Tie (5 vs 5): all four operators return false.
- Any score in the set unset: returns false (matches existing "unset → no fall-through" semantics).

## UI

### Variable picker (`blocks/chip.tsx` AddChipButton)

Add an "Aggregates" optgroup to the variable dropdown (placed after Nation Affinity, before any user-defined text variables). Two options: "Class Affinity", "Nation Affinity". Selecting one switches the operator dropdown to the aggregate operator set, and switches the value control to a class/nation dropdown.

### Chip pill (`blocks/chip.tsx` ChipPill)

Inline editing reuses the same shape as text/number chips:
- Label is the variable name, e.g. `CLASS AFFINITY`.
- Operator click → inline `<Select>` of the four aggregate ops, rendered with friendly labels.
- Value click → inline `<Select>` of the class or nation options, displayed using their existing user-facing labels (e.g. "Working Class", "Upper Class", "Folos", …).

### Chip color

Use the same `IMPACT_CHIP_COLORS` / `paletteColor` fallback. The aggregate variable can pick its color by `aggregate_ref` — class and nation already have palette positions in the existing impact map; we just need to add `'class_affinity'` and `'nation_affinity'` entries (or compute from the underlying ref set).

### Preview view

No change to the preview value inputs themselves — aggregate chips read from the existing `numbers` selections for the underlying class/nation impact variables. As long as the user has set values for the underlying scores in the variable inputs section, aggregate chips evaluate correctly.

The "referenced variables" panel needs to also surface the underlying number_ref variables when an aggregate chip is present, so the user has inputs to set. Implementation: when computing `referencedVariables`, expand any aggregate variable into its underlying impact-column variables.

## Server actions

`src/app/(authed)/endings/frameworks/actions.ts`:
- `addChip` / `saveFramework` accept and persist `aggregate_value`.
- Validate kind/operator/value coherence per the new CHECK constraint shape.

## Tests

Per `docs/testing-protocol.md`:

**Unit (`src/lib/endings/evaluator.test.ts`)**

Table-driven matrix for aggregate chips:

| ref            | scores                          | operator | aggregate_value | expected |
|----------------|----------------------------------|----------|------------------|----------|
| class_affinity | proletariat=5, gentry=2          | `top=`     | `proletariat`    | true     |
| class_affinity | proletariat=5, gentry=2          | `top=`     | `gentry`         | false    |
| class_affinity | proletariat=5, gentry=2          | `top≠`     | `gentry`         | true     |
| class_affinity | proletariat=5, gentry=2          | `bottom=`  | `gentry`         | true     |
| class_affinity | proletariat=5, gentry=5          | any        | any              | false    |
| class_affinity | proletariat=null, gentry=2       | any        | any              | false    |
| nation_affinity| folos=3, emberlyn=1, spokgrad=2, pelico=0, epicenter=4 | `top=` | `epicenter` | true |
| nation_affinity| folos=3, emberlyn=1, spokgrad=2, pelico=0, epicenter=4 | `bottom=` | `pelico` | true |

**Integration (`tests/integration/endings_v3_constraints.test.ts`)**
- Aggregate variable with `aggregate_ref` outside the allowed set → reject.
- Chip on aggregate variable with `text_value_id` set → reject.
- Chip on aggregate variable with `number_value` set → reject.
- Chip on text/number_ref variable with `aggregate_value` set → reject.
- New operators are accepted on aggregate-kind chips and rejected on others (if we want to be strict; otherwise document as "operator/kind cohesion is enforced client-side").

**E2E (`tests/e2e/endings-frameworks.spec.ts`)**
Extend the existing spec with one aggregate row: select Class Affinity, `top is`, `Working Class`. Save, reload, set proletariat=5 / gentry=2 in preview, assert content renders. Set proletariat=2 / gentry=5, assert it stops rendering.

## Verification

- `pnpm typecheck`, `pnpm lint` clean.
- `pnpm db:migrate` against a clean Supabase, then `pnpm test:int` clean.
- `pnpm dev`: build a framework with one aggregate row, exercise both top and bottom, both `=` and `≠`, confirm tie produces no match.
- New e2e spec passes via `pnpm test:e2e`.

## Followups (out of scope)

- **Tiebreakers.** Today: tie → no match. Real implementations might want lex order, "either is acceptable", or storyline-specific rules. Spec separately.
- **Combined Nat'l aggregate.** If the writing needs "the winning nation excluding Epicenter", expose it as a third aggregate ref (`nation_affinity_excl_epicenter`) or as an option on the existing one. Wait until authoring asks for it.
- **Manual color picker.** Still out of scope (master plan).
- **Logic tab migration to chip-row primitive.** Still its own future plan.
- **Phase 5 (warnings):** static overlap detection in editor + uncovered-values badge. The aggregate kind needs to be threaded through both — overlap analysis should treat aggregate constraints as a small finite enum (which class/nation is on top/bottom), and uncovered-values enumeration should include aggregate winners as part of the assignment space.
