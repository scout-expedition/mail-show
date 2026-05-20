# Endings Frameworks — Phase 5: Static warnings

Master plan: `docs/plans/archive/endings-frameworks-plan.md` (Phases 1–3).
Predecessor: `docs/plans/archive/endings-frameworks-phase4-plan.md` (aggregate variable kinds — shipped as PR #4 / commit `1225d8b`).

**Status:** shipped as PR #5 (`7cfa415`). Two follow-ups landed on top:

- PR #6 (`a8974f2`) — numeric interval analysis. Single-numeric-variable blocks now compute exact uncovered intervals via breakpoint enumeration. Mixed (numeric + finite) blocks still use the wildcard-and-partial path.
- PR #7 (`5b4badd`) — numeric row overlap detection. Per-row badge for partial overlap (later row's range intersects an earlier row's) and full numeric shadow (later row entirely contained).

Phase 6 (`docs/plans/archive/endings-frameworks-phase6-plan.md`, header-declared variables) re-points the uncovered analysis at the header's declared set; the numeric analyses here stay as-is and continue to apply.

## Context

Today the editor has a single warning: `shadowedRowIds()` flags rows that overlap an earlier row **for the current preview selections**. That requires the author to set values and notice the badge. Two failure modes that's bad at:

1. **Static shadowing** — row 2 can never fire because row 1 covers every assignment row 2 covers, but the badge only surfaces it for the specific preview values the author tried. The badge should fire from chip structure alone.
2. **Uncovered assignments** — assignments where *no* row matches and the condition block silently emits nothing. With finite-domain variables (text + aggregate), this is enumerable; the editor should tell the author exactly which combos fall through.

Both pieces are implementable as pure functions over the existing block/row/chip arrays. Both need the aggregate kind threaded through correctly — Phase 4's followup explicitly calls this out.

The Phase 3 `shadowedRowIds()` semantics are kept (used by the preview pane). Phase 5 adds two new pure functions and surfaces them in the editor.

## Design intent

1. **Static shadow detection.** Row R₂ is *statically shadowed* by an earlier row R₁ iff every assignment that satisfies R₂ also satisfies R₁. We compute this over the variables that actually appear on R₁ ∪ R₂.
2. **Uncovered-assignment enumeration.** For each condition block, enumerate the cartesian product of the finite-domain variables referenced by its chips. For each assignment, run the existing first-match-wins evaluator. If no row fires, the assignment is "uncovered".
3. **Numeric variables are conservatively excluded.** Their assignment space is infinite. v1 Phase 5 treats any row that contains a `number_ref` chip as "not statically analyzable" — it stays out of both the shadow analysis and the uncovered enumeration. The badge UI shows a small caveat ("partial coverage: numeric chips not analyzed") so the author isn't misled into thinking the warnings are exhaustive.
4. **Aggregate variables are finite-domain.** For each aggregate ref, the assignment space is the set of possible (winner, loser) outcomes plus the tie cases. The chip-predicate truth-table over those outcomes is small and constant-foldable.
5. **Tie outcome matches Phase 4 semantics.** Today every aggregate operator (`top=`, `top≠`, `bottom=`, `bottom≠`) returns false on a tie — Phase 4 left tiebreakers TBD. The static analysis models tie as a distinct outcome where every aggregate chip evaluates to false, so authors get an accurate "tie uncovered" warning that matches the runtime behaviour. **When tie-breaker logic lands later** (separate plan), the outcome enumeration here either drops the tie state (if every tie always resolves to one of the winners) or rewrites its truth-table; either way Phase 5's shape doesn't change but its tie-row needs to update.
5. **Editor-visible badges, not preview-only.** The two existing surfaces (per-row chip column, condition-block header) gain inline warning indicators that reflect static state — independent of preview selections.

## Schema

**No schema changes.** All analysis runs in TypeScript over the existing flat arrays.

## When the analysis fires

The two new pure functions run **on every edit** — same lifecycle as the existing runtime `shadowedRowIds()` in the preview pane. Concretely:

- `framework-editor.tsx` wraps both calls in `useMemo`, keyed on `[blockState, rowState, chipState, variableState, values]`. Recomputation only happens when those change.
- For the typical block shape (2-outcome variables, ≤4 referenced variables) the full enumeration is well under a millisecond, so continuous recomputation is safe. The 10k cap exists for the pathological case (many text variables × many values).
- No "Check" button, no on-save firing. The badges reflect the live editing state so authors see warnings immediately as they author.

## Static-analysis library

New file `src/lib/endings/static-analysis.ts`. Exports:

```ts
interface StaticShadow {
  /** The row that is shadowed (will never fire). */
  shadowed_row_id: string;
  /** The earlier row that covers it. */
  covered_by_row_id: string;
  /** True when the analysis is exact (only finite-domain chips on both rows). */
  exact: boolean;
}

interface UncoveredAssignment {
  block_id: string;
  /** Map of variable_id → outcome (text_value_id for text variables;
   *  serialized "winner|loser" for aggregate; never includes number_ref). */
  assignment: Record<string, string>;
}

export function staticShadowedRows(input: EvalInputs): StaticShadow[];
export function uncoveredAssignments(input: EvalInputs): UncoveredAssignment[];
```

Both reuse `EvalInputs` from the existing evaluator. The first-match semantics in `uncoveredAssignments` reuse the existing `evaluateRow()` so behaviour stays in lockstep — the only new code is the assignment enumerator.

### Finite-domain enumeration

For a single variable, the outcome set is:

- **text** — the set of `value_id`s for that variable (from `EndingVariableValue.variable_id`), plus a `null` "unset" outcome.
- **aggregate (class_affinity)** — `{proletariat_wins, gentry_wins, tie}` (3 states).
- **aggregate (nation_affinity)** — `{folos_top, emberlyn_top, spokgrad_top, pelico_top, epicenter_top, tie_top}` × `{folos_bottom, …, tie_bottom}` minus impossible combos (winner ≠ loser when neither is `tie`). Pruning leaves ~25 outcomes; well under the cartesian-explosion threshold.
- **number_ref** — excluded from enumeration. Rows referencing one are flagged with `exact: false` in shadow analysis and skipped in uncovered enumeration.

Each chip's predicate becomes a function `outcome → bool`. AND across a row, OR across "any earlier row matches" for shadow analysis.

### Exact shadow predicate

Row R₂ is shadowed by R₁ iff:

```
∀ assignment ∈ enumerate(vars(R₁) ∪ vars(R₂)):
  R₂(assignment) → R₁(assignment)
```

For finite domains this is a direct enumeration. We early-out on the first counter-example.

### Cartesian-explosion guard

The cartesian product of all referenced finite-domain variables can explode when a block references many text variables with many values each. Cap at `MAX_ENUMERATION = 10_000` outcomes; beyond that, skip uncovered enumeration for that block and surface a "(too many combinations to enumerate)" badge instead. The shadow analysis is pairwise (row × row), not full-product, so it stays cheap and isn't subject to the cap.

The cap is sized for the typical authoring shape — most variables have 2 outcomes, so a block with ≤13 referenced 2-outcome variables (2¹³ = 8192) stays under. Real frameworks rarely cross even a few hundred outcomes.

## Aggregate truth-table

Centralized helper that maps `(operator, aggregate_value, outcome) → bool`. The outcome encodes the (top_winner, bottom_winner) pair. Operators:

| operator | predicate |
| --- | --- |
| `top=`     | `top_winner == aggregate_value && top_winner !== 'tie'` |
| `top≠`     | `top_winner !== aggregate_value && top_winner !== 'tie'` |
| `bottom=`  | `bottom_winner == aggregate_value && bottom_winner !== 'tie'` |
| `bottom≠`  | `bottom_winner !== aggregate_value && bottom_winner !== 'tie'` |

For class_affinity, `top` and `bottom` are perfectly anticorrelated (only 2 cols), so the outcome simplifies to a 3-state enum. The helper handles both refs uniformly via `AGGREGATE_OPTIONS_BY_REF`.

## UI

### Per-row "shadowed" badge (editor, not preview)

`blocks/condition-block.tsx` already renders rows in `ConditionRow`. Add a small badge to the right side of the chip column when the row is in `staticShadowedRows()` output:

```
[chips column] [⚠ shadowed by row 2]
```

Hover tooltip: "this row's chip set is fully covered by row 2's, so first-match-wins means it can never fire". When `exact: false`, the badge reads `(partial)` and the tooltip explains numeric chips weren't analyzed.

### Per-block "uncovered" badge (editor)

`blocks/condition-block.tsx` already has a header that reads `Condition · N rows`. Append a sibling badge when `uncoveredAssignments()` returns rows for that block:

```
Condition · 3 rows · ⚠ 4 assignments uncovered
```

Click to expand a panel listing the assignments. Each assignment renders as a chip-line so the author can see exactly which combos fall through. When the cartesian-product cap kicks in, the badge reads `· too many combos to enumerate` and skips the listing.

### Preview pane unchanged

The runtime `shadowedRowIds()` badge already in preview stays as-is. The static badges supplement it; they don't replace it.

## Server actions

**No new server actions.** The analysis is pure and runs client-side.

## Files to add / change

- `src/lib/endings/static-analysis.ts` — **new**
- `src/lib/endings/static-analysis.test.ts` — **new**
- `src/app/(authed)/endings/frameworks/blocks/condition-block.tsx` — render the two badges; thread analysis output via props
- `src/app/(authed)/endings/frameworks/framework-editor.tsx` — call the analysis once per chipState change (memoized) and pass results down to BlockList

Files explicitly *not* changed:
- `src/lib/endings/evaluator.ts` — Phase 5 reuses the evaluator unchanged. Static analysis lives in its own module.
- Schema / migrations — none.
- Server actions — none.

## Testing

Per `docs/testing-protocol.md`:

### Unit (vitest, no DB)

`src/lib/endings/static-analysis.test.ts`:

- **Static shadow — text variables**
  - `[var=A]` covers `[var=A]` (identical chip) → R₂ shadowed
  - `[var≠A]` covers `[var=B]` (B≠A) → R₂ shadowed
  - `[var=A]` does not cover `[var=B]` → not shadowed
  - `[var=A AND mood=X]` shadowed by `[var=A]` (R₁ less restrictive) → shadowed
  - `[var=A]` shadowed by `[var=A AND mood=X]` (R₁ more restrictive) → NOT shadowed
  - empty row never matches → not shadowed by anything; never shadows anything

- **Static shadow — aggregate variables**
  - class_affinity: `[top=proletariat]` covers `[top=proletariat]`
  - class_affinity: `[top=proletariat]` does NOT cover `[top=gentry]`
  - class_affinity: `[top≠proletariat]` covers `[top=gentry]` (since on `top=gentry` outcomes top≠proletariat is also true)
  - nation_affinity: `[top=folos]` covers `[top=folos AND bottom=pelico]` → R₂ shadowed
  - tie outcome: no chip-predicate fires on tie, so a row that includes any aggregate chip never matches the tie outcome (consistent with Phase 4 evaluator)

- **Static shadow — mixed kinds**
  - row with a number_ref chip → `exact: false`; analysis falls back to "shadowed only if R₁ has no chips" (always-fires case)
  - row with both text + numeric → `exact: false`; shadowed only when finite-domain analysis already proves coverage independently of the numeric chip

- **Uncovered assignments — text only**
  - block with rows `[var=A]` and `[var=B]` and var has values {A,B,C} → C uncovered
  - block with rows `[var=A]` and `[var≠A]` → fully covered (no uncovered)
  - block with rows `[var=A AND mood=X]` and var values {A,B}, mood values {X,Y} → 3 uncovered: (A,Y), (B,X), (B,Y)

- **Uncovered assignments — aggregate**
  - class_affinity with rows `[top=proletariat]` and `[top=gentry]` → tie uncovered
  - class_affinity with rows `[top=proletariat]`, `[top=gentry]`, `[top≠proletariat AND top≠gentry]` → tie still uncovered (top≠X chip is false on tie per Phase 4 semantics)

- **Cartesian-product cap**
  - block whose enumeration exceeds `MAX_ENUMERATION` returns an empty `UncoveredAssignment[]` and a sentinel flag (or the analysis surfaces a "too many" indicator the UI reads); pin the contract.

- **Numeric variables in scope**
  - block with a number_ref chip → uncoveredAssignments skips that block entirely; pin behaviour with a test.

### Integration

None new. The analysis is pure; integration tests stay focused on schema + server actions.

### E2E

Extend `tests/e2e/endings-frameworks.spec.ts`:

- After saving a framework with two rows where row 2 is fully covered by row 1 (text variables only), assert the editor renders a "shadowed by row 1" badge on row 2.
- After saving a framework with one row matching `[var=A]` and a variable with values {A, B}, assert the condition-block header shows "1 assignment uncovered" and clicking it expands a list containing `var = B`.

## Phasing

Land in this order:

1. **Static-analysis library + tests** — pure TS, no UI. Land with the table-driven test matrix above. Get the matrix green before touching the editor.
2. **Editor wiring — per-row "shadowed" badge.** Smallest UI surface; no new layout.
3. **Editor wiring — per-block "uncovered" badge + expansion panel.** Larger surface; add the cap-exceeded fallback.
4. **E2E spec** — golden flow per protocol §Always.

Each step leaves the tree compiling and tests green.

## Verification

After all steps:

- `pnpm typecheck` clean.
- `pnpm lint` baseline unchanged.
- `pnpm test` green; new file at ≥ 25 cases covering the matrices above.
- `pnpm test:int` unchanged.
- `pnpm test:e2e` green including the new shadow + uncovered assertions.
- `pnpm dev` walkthrough:
  - Two text rows, second covered by first → shadow badge on row 2.
  - Two rows leaving one assignment unmatched → block header reads "1 assignment uncovered" with that combo listed.
  - One row referencing `world_status ≥ 0` → block header shows the partial-analysis caveat.

## Out of scope (followups)

- **Tiebreakers.** Spec separately. Imagined model: when the underlying scores tie, a tie-breaker rule (lex order, storyline-specific, etc.) returns a definite winner; both `top=X` and `top≠X` then evaluate against that resolved winner. So `[top=Working]` paired with `[top≠Working]` would together cover every assignment once tie-breakers exist. Phase 5's static analysis models the *current* "tie → false" semantics; when tie-breakers ship, the aggregate truth-table here updates and ties stop appearing in the uncovered list.
- **Recursive shadow / unreachable rows.** v1 scopes shadow analysis to a single condition block. A row inside a nested block can still be statically unreachable because of the *outer* row's chips — the same finite-domain machinery handles this, just with the outer chips folded into the row's predicate. Add as a separate pass once Phase 5's badges are stable.
- **Numeric interval analysis.** ~~v1 conservatively excludes numeric chips.~~ Shipped as PR #6 (gaps) and PR #7 (overlap) for the single-numeric-variable case. Mixed blocks (numeric + finite, or multiple numerics) still use the partial path; extending interval analysis to those cases is future work.
- **Combined Nat'l aggregate.** Same as Phase 4 — wait until authoring asks.
- **Logic tab migration to chip-row primitive.** Still its own future plan.
- **Manual color picker.** Still out of scope (master plan).
- **Autosave / collaborative editing.** Master plan §Followups — separate effort. Phase 5's analysis runs client-side and survives the autosave migration unchanged.
