// Pure evaluator for ending frameworks (v3 chip-row model).
//
// Walks the block tree and emits paragraph strings. Condition blocks pick
// the *first* matching row (AND across the row's chips); their child blocks
// render under that row. If no row matches, the block emits nothing.
//
// Inputs are flat row arrays — the same shapes the UI carries in state and
// that the server actions persist. The evaluator does no I/O and no React,
// so it's trivially testable.

import {
  AGGREGATE_OPTIONS_BY_REF,
  type AggregateRef,
  type EndingChipOperator,
  type EndingVariableKind,
} from "@/lib/db/enums";

export interface EvalBlock {
  id: string;
  parent_block_id: string | null;
  parent_row_id: string | null;
  block_type: "text" | "condition";
  text: string;
  sort_order: number;
}

export interface EvalRow {
  id: string;
  condition_block_id: string;
  sort_order: number;
}

export interface EvalChip {
  id: string;
  row_id: string;
  variable_id: string;
  operator: EndingChipOperator;
  text_value_id: string | null;
  number_value: number | null;
  aggregate_value: string | null;
  sort_order: number;
}

export interface EvalVariable {
  id: string;
  kind: EndingVariableKind;
  /** Set when kind === 'aggregate_ref'. */
  aggregate_ref: AggregateRef | null;
}

export interface PreviewSelections {
  /** value_id chosen for each text variable. Missing/null means unset. */
  textValueIds: Record<string, string | null>;
  /** numeric input for each number_ref variable. Missing/null means unset. */
  numbers: Record<string, number | null>;
  /**
   * Map from impact-column name (e.g. 'gentry') to the variable_id of the
   * seeded number_ref variable that wraps it. Aggregate chips use this to
   * look the underlying scores out of `numbers` without leaking variable
   * identity into the chip row data.
   *
   * Optional so existing tests + selections that don't touch aggregates
   * keep working.
   */
  numberRefByName?: Map<string, string>;
}

export const EMPTY_SELECTIONS: PreviewSelections = {
  textValueIds: {},
  numbers: {},
};

/**
 * Evaluate a single chip against the current selections. Unset variables
 * always return false (no fall-through).
 */
export function evaluateChip(
  chip: EvalChip,
  variable: EvalVariable,
  selections: PreviewSelections
): boolean {
  if (variable.kind === "text") {
    const selected = selections.textValueIds[variable.id];
    if (selected == null || chip.text_value_id == null) return false;
    const equal = selected === chip.text_value_id;
    if (chip.operator === "=") return equal;
    if (chip.operator === "≠") return !equal;
    return false; // numeric operators not valid for text variables
  }
  if (variable.kind === "aggregate_ref") {
    return evaluateAggregateChip(chip, variable, selections);
  }
  // number_ref
  const value = selections.numbers[variable.id];
  if (value == null || chip.number_value == null) return false;
  const target = chip.number_value;
  switch (chip.operator) {
    case "=":
      return value === target;
    case "≠":
      return value !== target;
    case "<":
      return value < target;
    case "≤":
      return value <= target;
    case ">":
      return value > target;
    case "≥":
      return value >= target;
    default:
      return false;
  }
}

/**
 * Aggregate chip semantics: argmax (top) / argmin (bottom) over the
 * underlying impact columns. `=` matches when the winner equals the
 * chip's aggregate_value; `≠` is the negation.
 *
 * Tie semantics: tie → false (operator agnostic). Authoring rarely
 * intends "either is acceptable", and we plan a tiebreaker proposal as
 * a follow-up.
 *
 * Any underlying score unset → false (matches "no fall-through" rule
 * for unset variables elsewhere in the evaluator).
 */
function evaluateAggregateChip(
  chip: EvalChip,
  variable: EvalVariable,
  selections: PreviewSelections
): boolean {
  if (variable.aggregate_ref == null) return false;
  if (chip.aggregate_value == null) return false;
  const cols = AGGREGATE_OPTIONS_BY_REF[variable.aggregate_ref];
  if (!cols || cols.length === 0) return false;
  const numberRefByName = selections.numberRefByName;
  if (!numberRefByName) return false;
  const vals: number[] = [];
  for (const col of cols) {
    const vid = numberRefByName.get(col);
    if (vid == null) return false;
    const v = selections.numbers[vid];
    if (v == null) return false;
    vals.push(v);
  }
  const isTop =
    chip.operator === "top=" || chip.operator === "top≠";
  const isBottom =
    chip.operator === "bottom=" || chip.operator === "bottom≠";
  if (!isTop && !isBottom) return false;
  const extreme = isTop ? Math.max(...vals) : Math.min(...vals);
  const tiedCount = vals.filter((v) => v === extreme).length;
  if (tiedCount > 1) return false;
  const winnerCol = cols[vals.indexOf(extreme)];
  const isEqual = winnerCol === chip.aggregate_value;
  return chip.operator === "top=" || chip.operator === "bottom="
    ? isEqual
    : !isEqual;
}

/**
 * Evaluate one row: AND across all of its chips. A row with zero chips
 * cannot match — it has no condition to satisfy.
 */
export function evaluateRow(
  rowChips: EvalChip[],
  variableIndex: Map<string, EvalVariable>,
  selections: PreviewSelections
): boolean {
  if (rowChips.length === 0) return false;
  for (const chip of rowChips) {
    const variable = variableIndex.get(chip.variable_id);
    if (!variable) return false;
    if (!evaluateChip(chip, variable, selections)) return false;
  }
  return true;
}

export interface EvalInputs {
  blocks: EvalBlock[];
  rows: EvalRow[];
  chips: EvalChip[];
  variables: EvalVariable[];
  selections: PreviewSelections;
}

interface Indexes {
  byParent: Map<string, EvalBlock[]>;
  rowsByBlock: Map<string, EvalRow[]>;
  chipsByRow: Map<string, EvalChip[]>;
  variableById: Map<string, EvalVariable>;
}

function buildIndexes(input: EvalInputs): Indexes {
  const byParent = new Map<string, EvalBlock[]>();
  for (const b of input.blocks) {
    const key = parentKey(b.parent_block_id, b.parent_row_id);
    const list = byParent.get(key);
    if (list) list.push(b);
    else byParent.set(key, [b]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order);
  }

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

  const variableById = new Map<string, EvalVariable>();
  for (const v of input.variables) variableById.set(v.id, v);

  return { byParent, rowsByBlock, chipsByRow, variableById };
}

export function parentKey(
  parent_block_id: string | null,
  parent_row_id: string | null
): string {
  return `${parent_block_id ?? "root"}:${parent_row_id ?? "root"}`;
}

/**
 * Render a framework into a flat list of paragraph strings under the
 * current selections. Condition blocks emit their first-matching row's
 * children; non-matching rows are silent.
 */
export function evaluateFramework(input: EvalInputs): string[] {
  const indexes = buildIndexes(input);
  const root = indexes.byParent.get(parentKey(null, null)) ?? [];
  return renderBlocks(root, indexes, input.selections);
}

function renderBlocks(
  blocks: EvalBlock[],
  indexes: Indexes,
  selections: PreviewSelections
): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.block_type === "text") {
      const trimmed = b.text.trim();
      if (trimmed.length > 0) out.push(b.text);
      continue;
    }
    // Condition block: first-match-wins across rows.
    const rows = indexes.rowsByBlock.get(b.id) ?? [];
    for (const row of rows) {
      const chips = indexes.chipsByRow.get(row.id) ?? [];
      if (!evaluateRow(chips, indexes.variableById, selections)) continue;
      const children =
        indexes.byParent.get(parentKey(b.id, row.id)) ?? [];
      out.push(...renderBlocks(children, indexes, selections));
      break; // first match wins
    }
  }
  return out;
}

/**
 * Same as evaluateFramework but also reports which rows would match in
 * isolation (i.e. ignoring earlier first-match-wins shadowing). Phase 3
 * builds overlap detection on top of this; included now so tests can pin
 * the API surface.
 */
export function matchingRowsByBlock(
  input: EvalInputs
): Map<string, string[]> {
  const indexes = buildIndexes(input);
  const out = new Map<string, string[]>();
  for (const [blockId, rows] of indexes.rowsByBlock) {
    const matching: string[] = [];
    for (const row of rows) {
      const chips = indexes.chipsByRow.get(row.id) ?? [];
      if (evaluateRow(chips, indexes.variableById, input.selections)) {
        matching.push(row.id);
      }
    }
    out.set(blockId, matching);
  }
  return out;
}

/**
 * Rows that match the current selections but lose to an earlier
 * first-match-wins row in the same condition block. Powers the preview
 * overlap badge.
 */
export function shadowedRowIds(input: EvalInputs): Set<string> {
  const matching = matchingRowsByBlock(input);
  const shadowed = new Set<string>();
  for (const ids of matching.values()) {
    for (let i = 1; i < ids.length; i++) shadowed.add(ids[i]);
  }
  return shadowed;
}
