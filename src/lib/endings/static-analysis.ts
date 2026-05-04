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
// Tie semantics here mirror the Phase 4 evaluator: when an aggregate's
// underlying scores tie, every aggregate operator returns false. Once a
// tie-breaker rule lands (separate plan) the tie outcome here either
// disappears (if ties always resolve) or its truth-table rewrites.
//
// All functions are pure; they reuse the EvalInputs shapes from
// `evaluator.ts` plus a `values` array for text-variable domains.

import {
  AGGREGATE_OPTIONS_BY_REF,
  type AggregateRef,
  type EndingChipOperator,
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

export interface StaticInputs {
  blocks: EvalBlock[];
  rows: EvalRow[];
  chips: EvalChip[];
  variables: EvalVariable[];
  values: StaticValue[];
}

export interface ShadowedRow {
  shadowed_row_id: string;
  covered_by_row_id: string;
}

export type BlockUncoveredStatus =
  | "covered"
  | "has_uncovered"
  | "cap_exceeded"
  | "skipped_numeric"
  | "no_finite_vars";

export interface BlockAnalysis {
  block_id: string;
  status: BlockUncoveredStatus;
  /** Each entry: `variable_id → outcome string` — `text_value_id` for text
   *  vars, `winner_top` or `winner_top|loser_bottom` for aggregates, or
   *  the special string `unset` when a chip's variable has no values
   *  defined yet. Empty unless `status === 'has_uncovered'`. */
  uncovered: Array<Record<string, string>>;
}

// Outcome encoding ------------------------------------------------------

export const TIE_OUTCOME = "tie";
export const UNSET_TEXT_OUTCOME = "unset";

/** All possible outcomes for a finite-domain variable. Returns null for
 *  number_ref (no finite outcome set) and for text variables with no
 *  values defined yet (only the unset outcome — those are tracked but
 *  never satisfy a chip). */
export function variableDomain(
  variable: EvalVariable,
  values: StaticValue[]
): string[] | null {
  if (variable.kind === "text") {
    const vids = values
      .filter((v) => v.variable_id === variable.id)
      .map((v) => v.id);
    return vids.length > 0
      ? [UNSET_TEXT_OUTCOME, ...vids]
      : [UNSET_TEXT_OUTCOME];
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
 */
export function chipMatchesOutcome(
  chip: EvalChip,
  variable: EvalVariable,
  outcome: string
): boolean {
  if (variable.kind === "text") {
    if (outcome === UNSET_TEXT_OUTCOME) return false;
    if (chip.text_value_id == null) return false;
    const equal = outcome === chip.text_value_id;
    if (chip.operator === "=") return equal;
    if (chip.operator === "≠") return !equal;
    return false;
  }
  if (variable.kind === "aggregate_ref") {
    if (!variable.aggregate_ref || chip.aggregate_value == null) return false;
    const { top, bottom } = splitAggregateOutcome(
      outcome,
      variable.aggregate_ref
    );
    const isTop = chip.operator === "top=" || chip.operator === "top≠";
    const isBottom =
      chip.operator === "bottom=" || chip.operator === "bottom≠";
    if (!isTop && !isBottom) return false;
    const winner = isTop ? top : bottom;
    if (winner === TIE_OUTCOME) return false; // Phase 4: any operator on tie → false
    const isEqual = winner === chip.aggregate_value;
    return chip.operator === "top=" || chip.operator === "bottom="
      ? isEqual
      : !isEqual;
  }
  // number_ref chips have no finite outcome set; callers should skip
  // these rows entirely.
  return false;
}

/** Does the row match the given variable→outcome assignment? */
function rowMatchesAssignment(
  rowChips: EvalChip[],
  variableIndex: Map<string, EvalVariable>,
  assignment: Map<string, string>
): boolean {
  if (rowChips.length === 0) return false; // matches Phase 1 evaluator
  for (const chip of rowChips) {
    const variable = variableIndex.get(chip.variable_id);
    if (!variable) return false;
    const outcome = assignment.get(chip.variable_id);
    if (outcome == null) return false;
    if (!chipMatchesOutcome(chip, variable, outcome)) return false;
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
        if (rowCovers(r1Chips, r2Chips, variableIndex, input.values)) {
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
  values: StaticValue[]
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
  for (const a of assignments) {
    const r2Match = rowMatchesAssignment(r2Chips, variableIndex, a);
    if (!r2Match) continue;
    const r1Match = rowMatchesAssignment(r1Chips, variableIndex, a);
    if (!r1Match) return false; // r2 matches here but r1 doesn't → not shadowed
  }
  return true;
}

// Public API: uncovered assignments -------------------------------------

/**
 * Per-block: enumerate every assignment over the finite-domain variables
 * referenced by the block's rows; flag the ones no row matches. Skips
 * blocks whose rows reference number_ref variables (infinite domain).
 */
export function uncoveredAssignmentsByBlock(
  input: StaticInputs
): Map<string, BlockAnalysis> {
  const { rowsByBlock, chipsByRow, variableIndex } = buildIndexes(input);
  const out = new Map<string, BlockAnalysis>();
  for (const [blockId, rows] of rowsByBlock) {
    const allChips: EvalChip[] = [];
    for (const r of rows) {
      const list = chipsByRow.get(r.id) ?? [];
      allChips.push(...list);
    }
    if (rowHasNumberRef(allChips, variableIndex)) {
      out.set(blockId, {
        block_id: blockId,
        status: "skipped_numeric",
        uncovered: [],
      });
      continue;
    }
    const varIds = [...new Set(allChips.map((c) => c.variable_id))];
    if (varIds.length === 0) {
      // No chips on any row → nothing to enumerate. Block emits nothing
      // for every assignment; report 'no_finite_vars' so the UI can
      // distinguish "trivially uncovered" from "fully covered".
      out.set(blockId, {
        block_id: blockId,
        status: "no_finite_vars",
        uncovered: [],
      });
      continue;
    }
    const dims: { id: string; outcomes: string[] }[] = [];
    for (const id of varIds) {
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
      });
      continue;
    }
    const uncovered: Array<Record<string, string>> = [];
    for (const a of assignments) {
      let covered = false;
      for (const r of rows) {
        const chips = chipsByRow.get(r.id) ?? [];
        if (rowMatchesAssignment(chips, variableIndex, a)) {
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
    });
  }
  return out;
}

// Convenience aliases used in tests / callers ---------------------------

export type { EndingChipOperator };
