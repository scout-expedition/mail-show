// Pure evaluator for ending documents — frameworks and logic docs share
// the same block tree. Frameworks end in `text` leaves and emit a list of
// paragraphs; logic docs end in `result` leaves and emit a single value
// (e.g. a tiebreak winner column name, or a framework UUID for the
// `framework_selection` doc).
//
// Walks the block tree. Condition blocks pick the *first* matching row
// (AND across the row's chips); their child blocks render under that row.
// If no row matches, the block emits nothing.
//
// Inputs are flat row arrays — the same shapes the UI carries in state and
// that the server actions persist. The evaluator does no I/O and no React,
// so it's trivially testable.

import {
  AGGREGATE_OPTIONS_BY_REF,
  RANDOM_ALL_SENTINEL,
  RANDOM_RESULT_SENTINEL,
  RANDOM_TIED_SENTINEL,
  TIEBREAK_KIND_BY_REF_SIDE,
  type AggregateRef,
  type EndingChipOperator,
  type EndingLogicKind,
  type EndingVariableKind,
} from "@/lib/db/enums";

export interface EvalBlock {
  id: string;
  parent_block_id: string | null;
  parent_row_id: string | null;
  block_type: "text" | "condition" | "result" | "fallback";
  text: string;
  /**
   * Set when block_type === 'result'. Carries either an aggregate column
   * name (`proletariat`, `folos`, …) for tiebreak docs, or the UUID of an
   * `ending_documents` row for the framework_selection doc. Null on text
   * and condition blocks.
   *
   * Optional so existing call sites that construct EvalBlock from the
   * frameworks-only `BlockState` (which predates the `result` block type)
   * keep compiling. Step 4 only widens the leaf vocabulary; the editor
   * surfaces switch over in later steps.
   */
  result_value?: string | null;
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
  /**
   * Pre-built `EvalInputs` for each tiebreak / selection logic doc, keyed
   * by `EndingLogicKind`. When an aggregate chip's underlying scores tie,
   * the evaluator runs the matching doc to resolve the winner.
   *
   * Optional. Tests + flows that don't touch aggregates leave it unset.
   */
  tiebreak_docs?: Map<EndingLogicKind, EvalInputs>;
  /**
   * Pre-resolved aggregate winners, keyed by `${ref}|${side}`. Computed
   * by `resolveAggregates(...)` once per evaluation pass — the framework
   * evaluator then reads the resolved column directly without
   * re-consulting the tiebreak doc per chip. This is the architectural
   * fix for random sentinels rolling differently per chip: when the
   * caller pre-resolves, every chip on the same (ref, side) sees the
   * same winner.
   *
   * `null` value = scores incomplete, no tiebreak doc available, or
   * doc returned an unresolvable result (chip evaluates to false in
   * those cases). Absent key = caller didn't pre-resolve; chip falls
   * back to the inline tiebreak path for backwards compatibility.
   */
  resolved_aggregates?: Map<string, string | null>;
}

/**
 * Build the lookup key used in `PreviewSelections.resolved_aggregates`
 * for an aggregate ref + side pair. Exported so callers and helpers
 * stay in sync on the format.
 */
export function aggregateKey(ref: AggregateRef, side: "top" | "bottom"): string {
  return `${ref}|${side}`;
}

export const EMPTY_SELECTIONS: PreviewSelections = {
  textValueIds: {},
  numbers: {},
};

/**
 * Evaluate a single chip against the current selections. Unset variables
 * always return false (no fall-through).
 *
 * `evaluatingDocs` threads the tiebreak-doc recursion guard down through
 * aggregate-chip resolution. Public callers pass an empty set (or rely on
 * the default).
 */
export function evaluateChip(
  chip: EvalChip,
  variable: EvalVariable,
  selections: PreviewSelections,
  evaluatingDocs: Set<EndingLogicKind> = new Set()
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
    return evaluateAggregateChip(chip, variable, selections, evaluatingDocs);
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
 * Tie semantics: when the underlying scores tie, look up the matching
 * tiebreak doc in `selections.tiebreak_docs` and run `evaluateDocument`.
 * If the doc resolves to one of the currently-tied column names, treat
 * that column as the resolved winner. Otherwise (no doc, no result, or
 * a non-tied option) fall back to "tie → false".
 *
 * Any underlying score unset → false (matches "no fall-through" rule
 * for unset variables elsewhere in the evaluator).
 *
 * `evaluatingDocs` is the cycle guard. If a tiebreak doc references back
 * (via aggregate chip on a tied score) into a doc already on the stack,
 * the recursion short-circuits to false rather than spinning.
 */
function evaluateAggregateChip(
  chip: EvalChip,
  variable: EvalVariable,
  selections: PreviewSelections,
  evaluatingDocs: Set<EndingLogicKind>
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
  let winnerCol: string;
  const side: "top" | "bottom" = isTop ? "top" : "bottom";
  if (tiedCount > 1) {
    // Tiebreak resolution. Prefer the caller's pre-resolved value
    // (set by `resolveAggregates` running once per evaluation pass)
    // so every chip on the same (ref, side) sees the same winner —
    // critical for random sentinels not rolling differently per
    // chip. Only when the caller didn't pre-resolve do we fall back
    // to the inline doc-eval path (kept for backwards compatibility
    // with existing tests).
    const tiedCols = cols.filter((_, i) => vals[i] === extreme);
    const preResolved = selections.resolved_aggregates?.get(
      aggregateKey(variable.aggregate_ref, side)
    );
    if (preResolved !== undefined) {
      if (preResolved == null) return false;
      if (!tiedCols.includes(preResolved)) return false;
      winnerCol = preResolved;
    } else {
      const inline = resolveTieInline(
        variable.aggregate_ref,
        side,
        cols,
        tiedCols,
        selections,
        evaluatingDocs
      );
      if (inline == null) return false;
      winnerCol = inline;
    }
  } else {
    winnerCol = cols[vals.indexOf(extreme)];
  }
  const isEqual = winnerCol === chip.aggregate_value;
  return chip.operator === "top=" || chip.operator === "bottom="
    ? isEqual
    : !isEqual;
}

/**
 * Inline (per-chip) tiebreak resolution — used by `evaluateAggregateChip`
 * when the caller didn't pre-resolve via `resolveAggregates`. Returns
 * the resolved column, or null when the doc / inputs / sentinel can't
 * produce a valid tied option.
 *
 * New code paths should pre-resolve. This helper preserves backwards
 * compatibility for existing tests + flows that don't.
 */
function resolveTieInline(
  ref: AggregateRef,
  side: "top" | "bottom",
  cols: string[],
  tiedCols: string[],
  selections: PreviewSelections,
  evaluatingDocs: Set<EndingLogicKind>,
  /** When provided, set to true if the resolution came from a random
   *  sentinel (UI uses this to surface a die icon + reroll). */
  fromRandom?: { value: boolean }
): string | null {
  const { kind, invert } = TIEBREAK_KIND_BY_REF_SIDE[ref][side];
  const doc = selections.tiebreak_docs?.get(kind);
  if (!doc) return null;
  if (evaluatingDocs.has(kind)) return null;
  const nextEvaluating = new Set(evaluatingDocs);
  nextEvaluating.add(kind);
  const result = evaluateDocumentInternal(doc, nextEvaluating);
  if (result.length !== 1) return null;
  const docResult = result[0];
  let resolved: string | null;
  if (
    docResult === RANDOM_RESULT_SENTINEL ||
    docResult === RANDOM_TIED_SENTINEL
  ) {
    // Random of the currently-tied options. Used to be the only random
    // mode; the legacy `__random__` value still maps here.
    if (tiedCols.length === 0) return null;
    resolved = tiedCols[Math.floor(Math.random() * tiedCols.length)];
    if (fromRandom) fromRandom.value = true;
  } else if (docResult === RANDOM_ALL_SENTINEL) {
    // Random of every option in the aggregate's column set. May roll a
    // non-tied option, which the post-resolve `tiedCols.includes`
    // check below will reject (chip evaluates false in that case).
    if (cols.length === 0) return null;
    resolved = cols[Math.floor(Math.random() * cols.length)];
    if (fromRandom) fromRandom.value = true;
  } else if (invert) {
    if (cols.length !== 2 || tiedCols.length !== 2) return null;
    resolved = cols.find((c) => c !== docResult) ?? null;
  } else {
    resolved = docResult;
  }
  // Reject any resolution that doesn't land on a currently-tied
  // option — the chip can only match if the winner is among the
  // tied set.
  if (!resolved || !tiedCols.includes(resolved)) return null;
  return resolved;
}

/**
 * Same as `resolveAggregates` but each value also carries `fromRandom`
 * — true when a random sentinel was rolled to produce the value. UI
 * surfaces this as a die icon + a "reroll" button.
 */
export interface AggregateResolution {
  value: string | null;
  fromRandom: boolean;
}

export function resolveAggregatesDetailed(
  chips: EvalChip[],
  variableIndex: Map<string, EvalVariable>,
  selections: PreviewSelections
): Map<string, AggregateResolution> {
  const out = new Map<string, AggregateResolution>();
  const numberRefByName = selections.numberRefByName;
  for (const c of chips) {
    const variable = variableIndex.get(c.variable_id);
    if (!variable || variable.kind !== "aggregate_ref") continue;
    const ref = variable.aggregate_ref;
    if (!ref) continue;
    let side: "top" | "bottom";
    if (c.operator === "top=" || c.operator === "top≠") side = "top";
    else if (c.operator === "bottom=" || c.operator === "bottom≠") side = "bottom";
    else continue;
    const key = aggregateKey(ref, side);
    if (out.has(key)) continue;

    const cols = AGGREGATE_OPTIONS_BY_REF[ref];
    if (!numberRefByName) {
      out.set(key, { value: null, fromRandom: false });
      continue;
    }
    const vals: number[] = [];
    let hasUnset = false;
    for (const col of cols) {
      const vid = numberRefByName.get(col);
      if (vid == null) {
        hasUnset = true;
        break;
      }
      const v = selections.numbers[vid];
      if (v == null) {
        hasUnset = true;
        break;
      }
      vals.push(v);
    }
    if (hasUnset) {
      out.set(key, { value: null, fromRandom: false });
      continue;
    }
    const extreme = side === "top" ? Math.max(...vals) : Math.min(...vals);
    const tiedCols = cols.filter((_, i) => vals[i] === extreme);
    if (tiedCols.length === 1) {
      out.set(key, { value: tiedCols[0], fromRandom: false });
      continue;
    }
    const fromRandom = { value: false };
    const resolved = resolveTieInline(
      ref,
      side,
      cols,
      tiedCols,
      selections,
      new Set(),
      fromRandom
    );
    const valid = resolved && tiedCols.includes(resolved);
    out.set(key, {
      value: valid ? resolved : null,
      fromRandom: fromRandom.value,
    });
  }
  return out;
}

/**
 * Pre-resolve every aggregate (ref, side) the chip set references.
 * Returns a map keyed by `aggregateKey(ref, side)` whose values are
 * either:
 *   - a resolved column name (winner column for that side, including
 *     non-tied cases where the answer is unambiguous), or
 *   - null (scores incomplete, no tiebreak doc, or doc returned an
 *     unresolvable result).
 *
 * Run this once per evaluation pass and stash the result in
 * `selections.resolved_aggregates` before calling the framework
 * evaluator. Random sentinels roll exactly once per call to this
 * function — every chip on the same (ref, side) then sees the same
 * winner. The function calls `Math.random()` for the random
 * sentinel; cache via `useMemo` if you need stable resolution
 * across renders.
 *
 * For UIs that need to surface "this resolution came from a random
 * sentinel" (e.g. a die-reroll button), call
 * `resolveAggregatesDetailed` instead.
 */
export function resolveAggregates(
  chips: EvalChip[],
  variableIndex: Map<string, EvalVariable>,
  selections: PreviewSelections
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const numberRefByName = selections.numberRefByName;
  for (const c of chips) {
    const variable = variableIndex.get(c.variable_id);
    if (!variable || variable.kind !== "aggregate_ref") continue;
    const ref = variable.aggregate_ref;
    if (!ref) continue;
    let side: "top" | "bottom";
    if (c.operator === "top=" || c.operator === "top≠") side = "top";
    else if (c.operator === "bottom=" || c.operator === "bottom≠") side = "bottom";
    else continue;
    const key = aggregateKey(ref, side);
    if (out.has(key)) continue;

    const cols = AGGREGATE_OPTIONS_BY_REF[ref];
    if (!numberRefByName) {
      out.set(key, null);
      continue;
    }
    const vals: number[] = [];
    let hasUnset = false;
    for (const col of cols) {
      const vid = numberRefByName.get(col);
      if (vid == null) {
        hasUnset = true;
        break;
      }
      const v = selections.numbers[vid];
      if (v == null) {
        hasUnset = true;
        break;
      }
      vals.push(v);
    }
    if (hasUnset) {
      out.set(key, null);
      continue;
    }
    const extreme = side === "top" ? Math.max(...vals) : Math.min(...vals);
    const tiedCols = cols.filter((_, i) => vals[i] === extreme);
    if (tiedCols.length === 1) {
      out.set(key, tiedCols[0]);
      continue;
    }
    // Tied — run the inline resolver (rolls random once per call).
    const resolved = resolveTieInline(
      ref,
      side,
      cols,
      tiedCols,
      selections,
      new Set()
    );
    out.set(key, resolved && tiedCols.includes(resolved) ? resolved : null);
  }
  return out;
}

/**
 * Evaluate one row: AND across all of its chips. A row with zero chips
 * cannot match — it has no condition to satisfy.
 *
 * `evaluatingDocs` threads the tiebreak-doc recursion guard.
 */
export function evaluateRow(
  rowChips: EvalChip[],
  variableIndex: Map<string, EvalVariable>,
  selections: PreviewSelections,
  evaluatingDocs: Set<EndingLogicKind> = new Set()
): boolean {
  if (rowChips.length === 0) return false;
  for (const chip of rowChips) {
    const variable = variableIndex.get(chip.variable_id);
    if (!variable) return false;
    if (!evaluateChip(chip, variable, selections, evaluatingDocs)) return false;
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
 * Render a document into a flat list of output strings under the current
 * selections. Condition blocks emit their first-matching row's children;
 * non-matching rows are silent. Text leaves push their text; result
 * leaves push their `result_value` and stop walking the current path
 * (first matching `result` wins for that path).
 *
 * For framework docs (text leaves only) the return is the paragraph
 * list. For logic docs the return is `[result_value]` for the first
 * matched leaf, or `[]` if no row matches.
 */
export function evaluateDocument(input: EvalInputs): string[] {
  return evaluateDocumentInternal(input, new Set());
}

/**
 * Backwards-compatible alias. Existing callers (preview view, framework
 * editor analysis path) still import this name; it now delegates to
 * `evaluateDocument`. Behaviour is identical for text-only documents.
 */
export function evaluateFramework(input: EvalInputs): string[] {
  return evaluateDocument(input);
}

function evaluateDocumentInternal(
  input: EvalInputs,
  evaluatingDocs: Set<EndingLogicKind>
): string[] {
  const indexes = buildIndexes(input);
  const root = indexes.byParent.get(parentKey(null, null)) ?? [];
  const result = renderBlocks(root, indexes, input.selections, evaluatingDocs);
  if (result.paragraphs.length > 0) return result.paragraphs;
  // Nothing matched. If a fallback block sits at the document root, use
  // its result_value. (Today only the framework_selection document seeds
  // a fallback; the migration's partial unique enforces at most one.)
  const fallback = root.find((b) => b.block_type === "fallback");
  if (fallback?.result_value != null && fallback.result_value !== "") {
    return [fallback.result_value];
  }
  return [];
}

interface RenderResult {
  paragraphs: string[];
  /** A `result` leaf fired in this subtree; the caller should stop
   *  walking later siblings as well. */
  stopped: boolean;
}

function renderBlocks(
  blocks: EvalBlock[],
  indexes: Indexes,
  selections: PreviewSelections,
  evaluatingDocs: Set<EndingLogicKind>
): RenderResult {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.block_type === "text") {
      const trimmed = b.text.trim();
      if (trimmed.length > 0) out.push(b.text);
      continue;
    }
    if (b.block_type === "result") {
      // First matching `result` leaf wins for this path. Push the value
      // and signal the caller to stop walking later siblings.
      if (b.result_value != null) out.push(b.result_value);
      return { paragraphs: out, stopped: true };
    }
    if (b.block_type === "fallback") {
      // Fallback blocks fire only if the rest of the walk produced
      // nothing — handled at evaluateDocumentInternal, not mid-walk.
      continue;
    }
    // Condition block: first-match-wins across rows.
    const rows = indexes.rowsByBlock.get(b.id) ?? [];
    for (const row of rows) {
      const chips = indexes.chipsByRow.get(row.id) ?? [];
      if (
        !evaluateRow(chips, indexes.variableById, selections, evaluatingDocs)
      )
        continue;
      const children =
        indexes.byParent.get(parentKey(b.id, row.id)) ?? [];
      const childRender = renderBlocks(
        children,
        indexes,
        selections,
        evaluatingDocs
      );
      out.push(...childRender.paragraphs);
      if (childRender.stopped) return { paragraphs: out, stopped: true };
      break; // first match wins
    }
  }
  return { paragraphs: out, stopped: false };
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
