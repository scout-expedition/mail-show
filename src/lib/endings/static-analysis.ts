// Static (preview-independent) analysis for ending frameworks.
//
// Two warnings the editor surfaces from chip structure alone — no preview
// values needed:
//
//  * Shadowed rows — row R₂ can never fire because every assignment that
//    satisfies R₂ also satisfies an earlier row R₁ in the same block.
//  * Uncovered assignments — combinations of variable outcomes that no
//    row in the block matches, so the block silently emits nothing.
//
// Numeric (number_ref) chips have an infinite assignment space; v1 skips
// any row / block that touches one. Text + aggregate variables are
// finite-domain so they get exact analysis.
//
// Tie semantics: by default ties produce no match (matches the Phase 4
// evaluator). Callers that have populated tiebreak docs pass a
// `tiebreakDocs` map; when a chip's relevant side has a non-empty doc,
// the analysis drops `tie` outcomes from that chip's enumeration — the
// chip is treated as potentially matching. This is intentionally coarse:
// we don't statically evaluate whether the tiebreak doc actually covers
// every tied assignment. The uncovered list stays a lower bound.
//
// All functions are pure; they reuse the EvalInputs shapes from
// `evaluator.ts` plus a `values` array for text-variable domains.

import {
  AGGREGATE_OPTIONS_BY_REF,
  TIEBREAK_KIND_BY_REF_SIDE,
  type AggregateRef,
  type EndingChipOperator,
  type EndingLogicKind,
} from "@/lib/db/enums";
import type {
  EvalBlock,
  EvalChip,
  EvalRow,
  EvalVariable,
} from "./evaluator";

/** Cap on cartesian-product size per block. Above this, uncovered
 *  enumeration is skipped — see plan §Cartesian-explosion guard. */
export const MAX_ENUMERATION = 10_000;

export interface StaticValue {
  id: string;
  variable_id: string;
}

/** Header-declared variable for a condition block (Phase 6). When the
 *  caller supplies these, the uncovered analysis enumerates over the
 *  declared set instead of the chip-derived union. Older callers that
 *  omit it fall back to the pre-Phase-6 chip-derived behaviour. */
export interface DeclaredBlockVariable {
  condition_block_id: string;
  variable_id: string;
}

/**
 * Per-tiebreak-doc summary for static analysis. The check is intentionally
 * coarse — we don't statically evaluate the doc against every assignment;
 * we only consult `isEmpty` to decide whether to drop `tie` from a chip's
 * outcome enumeration.
 */
export interface TiebreakDocSummary {
  isEmpty: boolean;
}

export type TiebreakDocsMap = Map<EndingLogicKind, TiebreakDocSummary>;

export interface StaticInputs {
  blocks: EvalBlock[];
  rows: EvalRow[];
  chips: EvalChip[];
  variables: EvalVariable[];
  values: StaticValue[];
  blockVariables?: DeclaredBlockVariable[];
  /**
   * Optional per-logic-kind tiebreak doc summaries. When a kind is present
   * with `isEmpty: false`, aggregate chips on the matching side treat
   * `tie` outcomes as covered (we can't prove they're uncovered without a
   * full doc evaluation, which v1 doesn't do). Absent / empty → ties stay
   * in the uncovered enumeration (Phase 5 semantics).
   */
  tiebreakDocs?: TiebreakDocsMap;
}

export interface ShadowedRow {
  shadowed_row_id: string;
  covered_by_row_id: string;
}

export type BlockUncoveredStatus =
  | "covered"
  | "has_uncovered"
  | "cap_exceeded"
  | "no_finite_vars";

export interface BlockAnalysis {
  block_id: string;
  status: BlockUncoveredStatus;
  /** Each entry: `variable_id → outcome string` — `text_value_id` for text
   *  vars, `winner_top` or `winner_top|loser_bottom` for aggregates.
   *  Empty unless `status === 'has_uncovered'`. */
  uncovered: Array<Record<string, string>>;
  /** Numeric-domain gaps on the block's single numeric variable. Only
   *  populated when the block references *exactly one* numeric variable
   *  and *no* finite-domain variables. For mixed blocks (numeric +
   *  finite, or multiple numerics) interval analysis isn't run; those
   *  blocks fall back to the partial-coverage path below. */
  numericGaps: NumericGap[];
  /** True when the analysis couldn't be exact — e.g. mixed numeric +
   *  finite chips, or multiple numeric variables. The uncovered list
   *  is then a lower bound (more combos may be uncovered at runtime
   *  once numeric constraints apply). */
  partial: boolean;
}

export interface NumericGap {
  variable_id: string;
  /** Lower bound; -Infinity for unbounded below. */
  low: number;
  /** Upper bound; Infinity for unbounded above. */
  high: number;
  lowInclusive: boolean;
  highInclusive: boolean;
}

// Outcome encoding ------------------------------------------------------

export const TIE_OUTCOME = "tie";
export const UNSET_TEXT_OUTCOME = "unset";

/** Possible *authoring* outcomes for a finite-domain variable. The
 *  runtime "unset" state is intentionally excluded — authors don't
 *  branch on absence; they branch on values — so leaving it out keeps
 *  the uncovered list focused on real gaps. Returns null for number_ref
 *  (no finite outcome set) and for text variables with no values
 *  defined yet (no enumerable outcomes). */
export function variableDomain(
  variable: EvalVariable,
  values: StaticValue[]
): string[] | null {
  if (variable.kind === "text" || variable.kind === "smart_ref") {
    // Smart variables enumerate over the distinct strings their tree can
    // resolve to. The caller is responsible for feeding synthetic
    // StaticValue rows (`{ id: <unique return string>, variable_id }`)
    // alongside the real text-variable values.
    const vids = values
      .filter((v) => v.variable_id === variable.id)
      .map((v) => v.id);
    return vids.length > 0 ? vids : null;
  }
  if (variable.kind === "aggregate_ref" && variable.aggregate_ref) {
    return aggregateOutcomes(variable.aggregate_ref);
  }
  return null;
}

/**
 * Enumerate the legal (top_winner, bottom_winner) pairs for an aggregate
 * ref. Encoded as `top|bottom`; for class_affinity (2 cols) only the top
 * varies and bottom is implied, so we collapse to the top label.
 *
 * Constraints encoded: top_winner ≠ bottom_winner unless both are 'tie'
 * (i.e., everything tied means both axes tie together). Tie at top is
 * independent from tie at bottom otherwise.
 */
function aggregateOutcomes(ref: AggregateRef): string[] {
  const cols = AGGREGATE_OPTIONS_BY_REF[ref];
  if (!cols || cols.length === 0) return [];
  if (cols.length === 2) {
    // Class affinity: only 3 distinguishable outcomes. Top fully
    // determines bottom. Encode as top label only.
    return [`${cols[0]}|${cols[1]}`, `${cols[1]}|${cols[0]}`, TIE_OUTCOME];
  }
  const out: string[] = [];
  const tops = [...cols, TIE_OUTCOME];
  const bottoms = [...cols, TIE_OUTCOME];
  for (const top of tops) {
    for (const bottom of bottoms) {
      if (top === TIE_OUTCOME && bottom !== TIE_OUTCOME) {
        // Top tied but bottom unique is legal — top tie means several
        // cols share the max but bottom can still be one specific col.
        out.push(`${top}|${bottom}`);
        continue;
      }
      if (bottom === TIE_OUTCOME && top !== TIE_OUTCOME) {
        out.push(`${top}|${bottom}`);
        continue;
      }
      if (top === TIE_OUTCOME && bottom === TIE_OUTCOME) {
        out.push(TIE_OUTCOME);
        continue;
      }
      // Both unique winners — must be different cols.
      if (top !== bottom) out.push(`${top}|${bottom}`);
    }
  }
  return out;
}

/**
 * Decode a class_affinity / nation_affinity outcome into (top, bottom)
 * column names. 'tie' on either side means the corresponding extreme is
 * shared by ≥2 cols.
 */
function splitAggregateOutcome(
  outcome: string,
  ref: AggregateRef
): { top: string; bottom: string } {
  if (outcome === TIE_OUTCOME) return { top: TIE_OUTCOME, bottom: TIE_OUTCOME };
  const idx = outcome.indexOf("|");
  if (idx < 0) {
    // class_affinity-style "X|Y" should always have a separator; defensive
    // fallback for unforeseen encodings.
    return { top: outcome, bottom: TIE_OUTCOME };
  }
  const cols = AGGREGATE_OPTIONS_BY_REF[ref] ?? [];
  const top = outcome.slice(0, idx);
  const bottom = outcome.slice(idx + 1);
  // class_affinity stores `${cols[0]}|${cols[1]}`; the left side IS the
  // top winner and the right side IS the bottom winner. Same shape as
  // nation. So splitting on '|' is correct for both.
  void cols;
  return { top, bottom };
}

// Chip predicates -------------------------------------------------------

/**
 * Evaluate a single chip against a single outcome string for its
 * variable. Mirrors the runtime evaluator's per-kind branches but acts
 * on outcome enums rather than user-set selections.
 *
 * `tiebreakDocs` is consulted for aggregate chips: when the chip's side
 * (top / bottom) has a non-empty tiebreak doc and the outcome is a tie
 * on that side, the chip is treated as matching (we can't statically
 * prove the tie is uncovered, so we conservatively cover it).
 */
export function chipMatchesOutcome(
  chip: EvalChip,
  variable: EvalVariable,
  outcome: string,
  tiebreakDocs?: TiebreakDocsMap
): boolean {
  if (variable.kind === "text") {
    if (outcome === UNSET_TEXT_OUTCOME) return false;
    if (chip.text_value_id == null) return false;
    const equal = outcome === chip.text_value_id;
    if (chip.operator === "=") return equal;
    if (chip.operator === "≠") return !equal;
    return false;
  }
  if (variable.kind === "smart_ref") {
    if (outcome === UNSET_TEXT_OUTCOME) return false;
    if (chip.aggregate_value == null) return false;
    const equal = outcome === chip.aggregate_value;
    if (chip.operator === "=") return equal;
    if (chip.operator === "≠") return !equal;
    return false;
  }
  if (variable.kind === "aggregate_ref") {
    if (!variable.aggregate_ref || chip.aggregate_value == null) return false;
    // Set-membership refs don't have a top/bottom outcome enumeration;
    // they're scored via the working tiebreak set at runtime, not via
    // any axis the static analyzer reasons about. Treat them as
    // never-matching for the lower-bound enumeration.
    if (variable.aggregate_ref === "nation_tiebreak_set") return false;
    const { top, bottom } = splitAggregateOutcome(
      outcome,
      variable.aggregate_ref
    );
    const isTop = chip.operator === "top=" || chip.operator === "top≠";
    const isBottom =
      chip.operator === "bottom=" || chip.operator === "bottom≠";
    if (!isTop && !isBottom) return false;
    const winner = isTop ? top : bottom;
    if (winner === TIE_OUTCOME) {
      // Tiebreak resolution: when the relevant side's tiebreak doc is
      // non-empty, drop tie from the chip's outcome enumeration (treat
      // it as covered). Empty / absent doc → keep Phase 4's "tie → false".
      // The class_affinity bottom side aliases through to the top doc
      // (TIEBREAK_KIND_BY_REF_SIDE encodes the share via `kind` —
      // `invert` is irrelevant for the static lower-bound check).
      const side: "top" | "bottom" = isTop ? "top" : "bottom";
      const { kind } =
        TIEBREAK_KIND_BY_REF_SIDE[variable.aggregate_ref][side];
      const summary = tiebreakDocs?.get(kind);
      if (summary && !summary.isEmpty) return true;
      return false;
    }
    const isEqual = winner === chip.aggregate_value;
    return chip.operator === "top=" || chip.operator === "bottom="
      ? isEqual
      : !isEqual;
  }
  // number_ref chips have no finite outcome set; callers should skip
  // these rows entirely.
  return false;
}

/** Does the row match the given variable→outcome assignment?
 *
 *  Chips on variables in `wildcardVarIds` are treated as always-match
 *  — used by the uncovered analysis to wildcard number_ref chips (no
 *  finite domain) and aggregate refs we deliberately don't enumerate
 *  (e.g. nation_affinity, ~31 combinations). Shadow analysis passes
 *  an empty set so it stays strict: wildcarding numeric chips would
 *  over-report shadowing across rows with non-overlapping numeric
 *  constraints. */
function rowMatchesAssignment(
  rowChips: EvalChip[],
  variableIndex: Map<string, EvalVariable>,
  assignment: Map<string, string>,
  wildcardVarIds: ReadonlySet<string>,
  tiebreakDocs?: TiebreakDocsMap
): boolean {
  if (rowChips.length === 0) return false; // matches Phase 1 evaluator
  for (const chip of rowChips) {
    const variable = variableIndex.get(chip.variable_id);
    if (!variable) return false;
    if (wildcardVarIds.has(chip.variable_id)) continue;
    const outcome = assignment.get(chip.variable_id);
    if (outcome == null) return false;
    if (!chipMatchesOutcome(chip, variable, outcome, tiebreakDocs)) return false;
  }
  return true;
}

// Indexes ---------------------------------------------------------------

interface Indexes {
  rowsByBlock: Map<string, EvalRow[]>;
  chipsByRow: Map<string, EvalChip[]>;
  variableIndex: Map<string, EvalVariable>;
}

function buildIndexes(input: StaticInputs): Indexes {
  const rowsByBlock = new Map<string, EvalRow[]>();
  for (const r of input.rows) {
    const list = rowsByBlock.get(r.condition_block_id);
    if (list) list.push(r);
    else rowsByBlock.set(r.condition_block_id, [r]);
  }
  for (const list of rowsByBlock.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }
  const chipsByRow = new Map<string, EvalChip[]>();
  for (const c of input.chips) {
    const list = chipsByRow.get(c.row_id);
    if (list) list.push(c);
    else chipsByRow.set(c.row_id, [c]);
  }
  for (const list of chipsByRow.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }
  const variableIndex = new Map<string, EvalVariable>();
  for (const v of input.variables) variableIndex.set(v.id, v);
  return { rowsByBlock, chipsByRow, variableIndex };
}

function rowVariableIds(chips: EvalChip[]): string[] {
  const ids = new Set<string>();
  for (const c of chips) ids.add(c.variable_id);
  return [...ids];
}

function rowHasNumberRef(
  chips: EvalChip[],
  variableIndex: Map<string, EvalVariable>
): boolean {
  return chips.some((c) => {
    const v = variableIndex.get(c.variable_id);
    return v?.kind === "number_ref";
  });
}

// Cartesian enumeration -------------------------------------------------

/**
 * Enumerate all assignments over the given variables. Each assignment
 * is a fresh Map so callers can stash it. Caller may pass `cap` to
 * short-circuit; returns null when the product would exceed `cap`.
 */
function enumerateAssignments(
  vars: { id: string; outcomes: string[] }[],
  cap: number
): Array<Map<string, string>> | null {
  let total = 1;
  for (const v of vars) {
    total *= Math.max(1, v.outcomes.length);
    if (total > cap) return null;
  }
  const out: Array<Map<string, string>> = [];
  const indices = new Array(vars.length).fill(0);
  while (true) {
    const m = new Map<string, string>();
    for (let i = 0; i < vars.length; i++) {
      m.set(vars[i].id, vars[i].outcomes[indices[i]]);
    }
    out.push(m);
    // increment indices like an odometer
    let i = vars.length - 1;
    while (i >= 0) {
      indices[i]++;
      if (indices[i] < vars[i].outcomes.length) break;
      indices[i] = 0;
      i--;
    }
    if (i < 0) break;
  }
  return out;
}

// Public API: shadow detection ------------------------------------------

/**
 * Find rows that are fully covered by an earlier row in the same
 * condition block — given finite-domain analysis. Rows with any
 * number_ref chip (or whose earlier siblings have one) are skipped:
 * we don't have an interval analyzer in v1.
 */
export function staticShadowedRows(input: StaticInputs): ShadowedRow[] {
  const { rowsByBlock, chipsByRow, variableIndex } = buildIndexes(input);
  const out: ShadowedRow[] = [];
  for (const rows of rowsByBlock.values()) {
    for (let j = 1; j < rows.length; j++) {
      const r2 = rows[j];
      const r2Chips = chipsByRow.get(r2.id) ?? [];
      if (r2Chips.length === 0) continue; // empty row never matches → never shadowed
      if (rowHasNumberRef(r2Chips, variableIndex)) continue;
      // Search for an earlier row that fully covers r2.
      for (let i = 0; i < j; i++) {
        const r1 = rows[i];
        const r1Chips = chipsByRow.get(r1.id) ?? [];
        if (r1Chips.length === 0) continue; // never matches; can't shadow
        if (rowHasNumberRef(r1Chips, variableIndex)) continue;
        if (
          rowCovers(
            r1Chips,
            r2Chips,
            variableIndex,
            input.values,
            input.tiebreakDocs
          )
        ) {
          out.push({
            shadowed_row_id: r2.id,
            covered_by_row_id: r1.id,
          });
          break; // one record per shadowed row
        }
      }
    }
  }
  return out;
}

/**
 * Returns true iff every assignment that satisfies r2's chips also
 * satisfies r1's. Enumerates the cartesian product over the union of
 * referenced variables.
 */
function rowCovers(
  r1Chips: EvalChip[],
  r2Chips: EvalChip[],
  variableIndex: Map<string, EvalVariable>,
  values: StaticValue[],
  tiebreakDocs?: TiebreakDocsMap
): boolean {
  const varIds = new Set<string>([
    ...rowVariableIds(r1Chips),
    ...rowVariableIds(r2Chips),
  ]);
  const dims: { id: string; outcomes: string[] }[] = [];
  for (const id of varIds) {
    const v = variableIndex.get(id);
    if (!v) return false;
    const dom = variableDomain(v, values);
    if (dom == null) return false; // shouldn't happen; rowHasNumberRef filtered
    dims.push({ id, outcomes: dom });
  }
  const assignments = enumerateAssignments(dims, MAX_ENUMERATION);
  if (assignments == null) return false; // too big to decide
  const noWildcards: ReadonlySet<string> = new Set();
  for (const a of assignments) {
    const r2Match = rowMatchesAssignment(
      r2Chips,
      variableIndex,
      a,
      noWildcards,
      tiebreakDocs
    );
    if (!r2Match) continue;
    const r1Match = rowMatchesAssignment(
      r1Chips,
      variableIndex,
      a,
      noWildcards,
      tiebreakDocs
    );
    if (!r1Match) return false; // r2 matches here but r1 doesn't → not shadowed
  }
  return true;
}

// Public API: uncovered assignments -------------------------------------

/**
 * Per-block: compute uncovered assignments. The strategy depends on the
 * block's chip mix:
 *
 *  * Pure finite-domain (text + aggregate, no numeric) — exact enumeration.
 *  * Pure single numeric variable (no finite-domain chips) — interval
 *    analysis via `computeNumericGaps`.
 *  * Mixed (numeric + finite, or multiple numeric variables) — partial:
 *    enumerate the finite domain treating numeric chips as wildcards and
 *    set `partial: true`. The uncovered list is a lower bound.
 */
export function uncoveredAssignmentsByBlock(
  input: StaticInputs
): Map<string, BlockAnalysis> {
  const { rowsByBlock, chipsByRow, variableIndex } = buildIndexes(input);
  // Phase 6: when blockVariables is supplied, the in-scope variable set
  // for a block is the declared set; chip-derived sets are no longer
  // used. Older callers that omit blockVariables fall back to chip-
  // derived behaviour for compatibility.
  const declaredByBlock = new Map<string, string[]>();
  if (input.blockVariables) {
    for (const bv of input.blockVariables) {
      const list = declaredByBlock.get(bv.condition_block_id);
      if (list) list.push(bv.variable_id);
      else declaredByBlock.set(bv.condition_block_id, [bv.variable_id]);
    }
  }
  const out = new Map<string, BlockAnalysis>();
  for (const [blockId, rows] of rowsByBlock) {
    const allChips: EvalChip[] = [];
    for (const r of rows) {
      const list = chipsByRow.get(r.id) ?? [];
      allChips.push(...list);
    }
    const inScopeIds = input.blockVariables
      ? declaredByBlock.get(blockId) ?? []
      : [...new Set(allChips.map((c) => c.variable_id))];
    const finiteVarIds = inScopeIds.filter((id) => {
      const v = variableIndex.get(id);
      return v != null && v.kind !== "number_ref";
    });
    const numericVarIds = inScopeIds.filter((id) => {
      const v = variableIndex.get(id);
      return v?.kind === "number_ref";
    });
    // Aggregate refs we deliberately don't enumerate over (currently
    // just nation_affinity — its ~31 top/bottom combinations produce
    // too noisy an uncovered list). Treat their chips as wildcards,
    // mirroring how number_ref chips behave. Shadow detection still
    // enumerates these via variableDomain — this opt-out is scoped to
    // uncovered-assignment surfacing only.
    const unenumerableAggregateIds = finiteVarIds.filter((id) => {
      const v = variableIndex.get(id);
      if (!v || v.kind !== "aggregate_ref") return false;
      return v.aggregate_ref === "nation_affinity";
    });
    const enumerableFiniteVarIds = finiteVarIds.filter(
      (id) => !unenumerableAggregateIds.includes(id)
    );
    const wildcardVarIds: ReadonlySet<string> = new Set([
      ...numericVarIds,
      ...unenumerableAggregateIds,
    ]);
    const partial =
      numericVarIds.length > 1 ||
      (numericVarIds.length === 1 && enumerableFiniteVarIds.length > 0) ||
      unenumerableAggregateIds.length > 0;

    // Pure single-numeric-variable case → exact interval analysis.
    if (
      enumerableFiniteVarIds.length === 0 &&
      unenumerableAggregateIds.length === 0 &&
      numericVarIds.length === 1
    ) {
      const numericVarId = numericVarIds[0];
      const gaps = computeNumericGaps(rows, chipsByRow, numericVarId);
      out.set(blockId, {
        block_id: blockId,
        status: gaps.length > 0 ? "has_uncovered" : "covered",
        uncovered: [],
        numericGaps: gaps.map((g) => ({ variable_id: numericVarId, ...g })),
        partial: false,
      });
      continue;
    }

    if (enumerableFiniteVarIds.length === 0) {
      // No enumerable finite-domain chips. Either: no finite chips at
      // all, multiple numerics, or only unenumerable aggregates
      // (e.g. nation_affinity) in scope — nothing to enumerate over.
      out.set(blockId, {
        block_id: blockId,
        status: "no_finite_vars",
        uncovered: [],
        numericGaps: [],
        partial,
      });
      continue;
    }
    const dims: { id: string; outcomes: string[] }[] = [];
    for (const id of enumerableFiniteVarIds) {
      const v = variableIndex.get(id);
      if (!v) continue;
      const dom = variableDomain(v, input.values);
      if (dom == null) continue;
      dims.push({ id, outcomes: dom });
    }
    const assignments = enumerateAssignments(dims, MAX_ENUMERATION);
    if (assignments == null) {
      out.set(blockId, {
        block_id: blockId,
        status: "cap_exceeded",
        uncovered: [],
        numericGaps: [],
        partial,
      });
      continue;
    }
    const uncovered: Array<Record<string, string>> = [];
    for (const a of assignments) {
      let covered = false;
      for (const r of rows) {
        const chips = chipsByRow.get(r.id) ?? [];
        if (
          rowMatchesAssignment(
            chips,
            variableIndex,
            a,
            wildcardVarIds,
            input.tiebreakDocs
          )
        ) {
          covered = true;
          break;
        }
      }
      if (!covered) {
        const obj: Record<string, string> = {};
        for (const [k, v] of a) obj[k] = v;
        uncovered.push(obj);
      }
    }
    out.set(blockId, {
      block_id: blockId,
      status: uncovered.length > 0 ? "has_uncovered" : "covered",
      uncovered,
      numericGaps: [],
      partial,
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Numeric interval analysis
// ---------------------------------------------------------------------

/**
 * For a block whose only chipped variable is `variableId` (a number_ref),
 * compute the set of values where no row matches. Strategy: collect all
 * chip number_values as breakpoints, split the real line into the
 * resulting segments (open intervals + breakpoint singletons), test
 * coverage at one representative per segment, then merge contiguous
 * uncovered segments into intervals.
 */
function computeNumericGaps(
  rows: EvalRow[],
  chipsByRow: Map<string, EvalChip[]>,
  variableId: string
): Omit<NumericGap, "variable_id">[] {
  const bps = new Set<number>();
  for (const r of rows) {
    for (const c of chipsByRow.get(r.id) ?? []) {
      if (c.variable_id === variableId && c.number_value != null) {
        bps.add(c.number_value);
      }
    }
  }
  const sortedBps = [...bps].sort((a, b) => a - b);

  // Block matches a value iff some row's chips on this variable all
  // match that value (AND across the row's chips). Empty rows never
  // fire. Rows whose chips are entirely on other variables don't apply
  // here either — but in the single-numeric-var-only path, there are no
  // such rows.
  function blockCoversValue(v: number): boolean {
    for (const r of rows) {
      const rowChips = (chipsByRow.get(r.id) ?? []).filter(
        (c) => c.variable_id === variableId
      );
      if (rowChips.length === 0) continue;
      let ok = true;
      for (const c of rowChips) {
        if (!chipNumericMatches(c, v)) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  type Seg = { type: "open" | "point"; low: number; high: number; covered: boolean };
  const segs: Seg[] = [];
  if (sortedBps.length === 0) {
    segs.push({
      type: "open",
      low: -Infinity,
      high: Infinity,
      covered: blockCoversValue(0),
    });
  } else {
    segs.push({
      type: "open",
      low: -Infinity,
      high: sortedBps[0],
      covered: blockCoversValue(sortedBps[0] - 1),
    });
    for (let i = 0; i < sortedBps.length; i++) {
      segs.push({
        type: "point",
        low: sortedBps[i],
        high: sortedBps[i],
        covered: blockCoversValue(sortedBps[i]),
      });
      if (i + 1 < sortedBps.length) {
        segs.push({
          type: "open",
          low: sortedBps[i],
          high: sortedBps[i + 1],
          covered: blockCoversValue(
            (sortedBps[i] + sortedBps[i + 1]) / 2
          ),
        });
      }
    }
    segs.push({
      type: "open",
      low: sortedBps[sortedBps.length - 1],
      high: Infinity,
      covered: blockCoversValue(sortedBps[sortedBps.length - 1] + 1),
    });
  }

  // Merge contiguous uncovered segments into intervals.
  const gaps: Omit<NumericGap, "variable_id">[] = [];
  let i = 0;
  while (i < segs.length) {
    if (segs[i].covered) {
      i++;
      continue;
    }
    const start = segs[i];
    let lastUncovered = start;
    while (i + 1 < segs.length && !segs[i + 1].covered) {
      i++;
      lastUncovered = segs[i];
    }
    gaps.push({
      low: start.low,
      high: lastUncovered.high,
      lowInclusive: start.type === "point",
      highInclusive: lastUncovered.type === "point",
    });
    i++;
  }
  return gaps;
}

// ---------------------------------------------------------------------
// Numeric row overlap
// ---------------------------------------------------------------------

export interface NumericRowOverlap {
  row_id: string;
  /** Earlier rows whose ranges contribute to this row's dead portion,
   *  in sort_order. */
  earlier_row_ids: string[];
  /** The dead portion(s) of this row's range — values where the row's
   *  chips would match but an earlier row already fires. */
  intervals: NumericGap[];
  /** True when the dead portion equals the row's entire range, so the
   *  row never fires at runtime. */
  fullShadow: boolean;
}

/**
 * For single-numeric-variable blocks (no finite-domain chips, exactly
 * one numeric variable referenced), report each row's "dead portion" —
 * the values the row claims to match but an earlier row covers first
 * (first-match-wins).
 */
export function numericRowOverlaps(input: StaticInputs): NumericRowOverlap[] {
  const { rowsByBlock, chipsByRow, variableIndex } = buildIndexes(input);
  const out: NumericRowOverlap[] = [];
  for (const rows of rowsByBlock.values()) {
    const allChips: EvalChip[] = [];
    for (const r of rows) {
      for (const c of chipsByRow.get(r.id) ?? []) allChips.push(c);
    }
    const numericVarIds = [
      ...new Set(
        allChips
          .filter(
            (c) => variableIndex.get(c.variable_id)?.kind === "number_ref"
          )
          .map((c) => c.variable_id)
      ),
    ];
    const finiteVarIds = [
      ...new Set(
        allChips
          .filter((c) => {
            const v = variableIndex.get(c.variable_id);
            return v != null && v.kind !== "number_ref";
          })
          .map((c) => c.variable_id)
      ),
    ];
    if (finiteVarIds.length > 0 || numericVarIds.length !== 1) continue;
    const variableId = numericVarIds[0];

    // Each row's range = AND of its chips on this variable.
    const rowSets = new Map<string, BareInterval[]>();
    for (const r of rows) {
      const rChips = (chipsByRow.get(r.id) ?? []).filter(
        (c) => c.variable_id === variableId
      );
      if (rChips.length === 0) continue; // empty row, never matches
      let set: BareInterval[] = [FULL_INTERVAL];
      for (const c of rChips) {
        set = intersectIntervalSets(set, chipToIntervalSet(c));
        if (set.length === 0) break;
      }
      if (set.length > 0) rowSets.set(r.id, set);
    }

    let cumulative: BareInterval[] = [];
    const earlierIds: string[] = [];
    for (const r of rows) {
      const mine = rowSets.get(r.id);
      if (mine == null) continue;
      const overlap = intersectIntervalSets(mine, cumulative);
      if (overlap.length > 0) {
        const fullShadow = intervalSetEqual(overlap, mine);
        out.push({
          row_id: r.id,
          earlier_row_ids: [...earlierIds],
          intervals: overlap.map((iv) => ({ ...iv, variable_id: variableId })),
          fullShadow,
        });
      }
      cumulative = unionIntervalSets(cumulative, mine);
      earlierIds.push(r.id);
    }
  }
  return out;
}

interface BareInterval {
  low: number;
  high: number;
  lowInclusive: boolean;
  highInclusive: boolean;
}

const FULL_INTERVAL: BareInterval = {
  low: -Infinity,
  high: Infinity,
  lowInclusive: false,
  highInclusive: false,
};

function chipToIntervalSet(chip: EvalChip): BareInterval[] {
  if (chip.number_value == null) return [];
  const t = chip.number_value;
  switch (chip.operator) {
    case "=":
      return [{ low: t, high: t, lowInclusive: true, highInclusive: true }];
    case "≠":
      return [
        { low: -Infinity, high: t, lowInclusive: false, highInclusive: false },
        { low: t, high: Infinity, lowInclusive: false, highInclusive: false },
      ];
    case "<":
      return [
        { low: -Infinity, high: t, lowInclusive: false, highInclusive: false },
      ];
    case "≤":
      return [
        { low: -Infinity, high: t, lowInclusive: false, highInclusive: true },
      ];
    case ">":
      return [
        { low: t, high: Infinity, lowInclusive: false, highInclusive: false },
      ];
    case "≥":
      return [
        { low: t, high: Infinity, lowInclusive: true, highInclusive: false },
      ];
    default:
      return [];
  }
}

function intersectInterval(
  a: BareInterval,
  b: BareInterval
): BareInterval | null {
  let low: number;
  let lowInclusive: boolean;
  if (a.low > b.low) {
    low = a.low;
    lowInclusive = a.lowInclusive;
  } else if (a.low < b.low) {
    low = b.low;
    lowInclusive = b.lowInclusive;
  } else {
    low = a.low;
    lowInclusive = a.lowInclusive && b.lowInclusive;
  }
  let high: number;
  let highInclusive: boolean;
  if (a.high < b.high) {
    high = a.high;
    highInclusive = a.highInclusive;
  } else if (a.high > b.high) {
    high = b.high;
    highInclusive = b.highInclusive;
  } else {
    high = a.high;
    highInclusive = a.highInclusive && b.highInclusive;
  }
  if (low > high) return null;
  if (low === high && (!lowInclusive || !highInclusive)) return null;
  return { low, high, lowInclusive, highInclusive };
}

function intersectIntervalSets(
  a: BareInterval[],
  b: BareInterval[]
): BareInterval[] {
  if (a.length === 0 || b.length === 0) return [];
  const out: BareInterval[] = [];
  for (const ia of a) {
    for (const ib of b) {
      const m = intersectInterval(ia, ib);
      if (m) out.push(m);
    }
  }
  return mergeIntervals(out);
}

function unionIntervalSets(
  a: BareInterval[],
  b: BareInterval[]
): BareInterval[] {
  return mergeIntervals([...a, ...b]);
}

function mergeIntervals(intervals: BareInterval[]): BareInterval[] {
  if (intervals.length <= 1) return intervals.map((iv) => ({ ...iv }));
  const sorted = [...intervals].sort((a, b) =>
    a.low === b.low
      ? a.lowInclusive === b.lowInclusive
        ? 0
        : a.lowInclusive
        ? -1
        : 1
      : a.low - b.low
  );
  const out: BareInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    const touches =
      cur.low < last.high ||
      (cur.low === last.high && (cur.lowInclusive || last.highInclusive));
    if (touches) {
      if (
        cur.high > last.high ||
        (cur.high === last.high && cur.highInclusive)
      ) {
        last.high = cur.high;
        last.highInclusive = cur.highInclusive;
      }
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function intervalSetEqual(a: BareInterval[], b: BareInterval[]): boolean {
  const ma = mergeIntervals(a);
  const mb = mergeIntervals(b);
  if (ma.length !== mb.length) return false;
  for (let i = 0; i < ma.length; i++) {
    if (
      ma[i].low !== mb[i].low ||
      ma[i].high !== mb[i].high ||
      ma[i].lowInclusive !== mb[i].lowInclusive ||
      ma[i].highInclusive !== mb[i].highInclusive
    ) {
      return false;
    }
  }
  return true;
}

function chipNumericMatches(chip: EvalChip, v: number): boolean {
  if (chip.number_value == null) return false;
  const t = chip.number_value;
  switch (chip.operator) {
    case "=":
      return v === t;
    case "≠":
      return v !== t;
    case "<":
      return v < t;
    case "≤":
      return v <= t;
    case ">":
      return v > t;
    case "≥":
      return v >= t;
    default:
      return false;
  }
}

// Convenience aliases used in tests / callers ---------------------------

export type { EndingChipOperator };
