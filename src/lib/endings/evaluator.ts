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
  parseRemoveSentinel,
  RANDOM_ALL_SENTINEL,
  RANDOM_REMAINING_SENTINEL,
  RANDOM_RESULT_SENTINEL,
  RANDOM_TIED_SENTINEL,
  TIEBREAK_KIND_BY_REF_SIDE,
  type AggregateRef,
  type EndingChipOperator,
  type EndingLogicKind,
  type EndingVariableKind,
  type ScoringAggregateRef,
} from "@/lib/db/enums";
import type { EndingVariableValue } from "@/lib/db/types";
import { substituteVariables } from "./text-substitution";

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
  /** Display name. Used by `substituteVariables` to resolve `@[Name]`
   *  tokens in text-block bodies. UNIQUE in the DB (see migration 0009),
   *  so name lookups can't silently collide. */
  name: string;
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
  /**
   * Mutable working set for the nation-tiebreak set-narrowing
   * evaluator. Set by `evaluateDocument` when an `initialTiebreakSet`
   * option is supplied; chips with `set_includes` / `set_excludes`
   * operators consult it. Mutated in-place by `__remove__:X` result
   * leaves so subsequent chip checks see the narrowed set.
   *
   * Outside narrowing mode this stays unset and the new operators /
   * sentinels evaluate to false (same as any other unmet input).
   */
  tiebreakWorkingSet?: Set<string>;
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
    if (chip.operator === "set_includes" || chip.operator === "set_excludes") {
      const set = selections.tiebreakWorkingSet;
      if (!set) return false;
      const target = chip.aggregate_value;
      if (target == null) return false;
      const has = set.has(target);
      return chip.operator === "set_includes" ? has : !has;
    }
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
  // Set-membership refs don't have score columns to compare; they're
  // handled by the dedicated set_includes/set_excludes branch in
  // `evaluateChip` and never reach this function for top/bottom ops.
  if (variable.aggregate_ref === "nation_tiebreak_set") return false;
  const ref: ScoringAggregateRef = variable.aggregate_ref;
  const cols = AGGREGATE_OPTIONS_BY_REF[ref];
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
      aggregateKey(ref, side)
    );
    if (preResolved !== undefined) {
      if (preResolved == null) return false;
      if (!tiedCols.includes(preResolved)) return false;
      winnerCol = preResolved;
    } else {
      const inline = resolveTieInline(
        ref,
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
  ref: ScoringAggregateRef,
  side: "top" | "bottom",
  cols: string[],
  tiedCols: string[],
  selections: PreviewSelections,
  evaluatingDocs: Set<EndingLogicKind>,
  /** When provided, set to true if the resolution came from a random
   *  sentinel (UI uses this to surface a die icon + reroll). */
  fromRandom?: { value: boolean },
  /** When provided AND the resolution came from a random sentinel,
   *  set to the pool the value was picked from (tied set vs full
   *  column set) so callers can validate cached rolls. */
  rollPool?: { value: string[] | null }
): string | null {
  const { kind, invert } = TIEBREAK_KIND_BY_REF_SIDE[ref][side];
  const doc = selections.tiebreak_docs?.get(kind);
  if (!doc) return null;
  if (evaluatingDocs.has(kind)) return null;
  const nextEvaluating = new Set(evaluatingDocs);
  nextEvaluating.add(kind);
  // Nation tiebreak docs run in set-narrowing mode with the
  // currently-tied columns as the initial working set. Class affinity
  // keeps the existing first-match-wins flow.
  const initialTiebreakSet =
    kind === "nation_affinity_top" || kind === "nation_affinity_bottom"
      ? tiedCols
      : undefined;
  const detailed = evaluateDocumentDetailedInternal(doc, nextEvaluating, {
    initialTiebreakSet,
  });
  // Narrowing-mode random sentinels carry the post-`__remove__:` working
  // set as `detailed.rollPool` — surface that as the chip's roll pool so
  // the framework preview's tiebreak indicator can offer a reroll button.
  if (
    detailed.rollSentinel != null &&
    detailed.rollPool &&
    detailed.rollPool.length > 0
  ) {
    const pool = detailed.rollPool;
    const resolvedRoll = pool[Math.floor(Math.random() * pool.length)];
    if (fromRandom) fromRandom.value = true;
    if (rollPool) rollPool.value = pool.slice();
    if (!tiedCols.includes(resolvedRoll)) return null;
    return resolvedRoll;
  }
  if (detailed.paragraphs.length !== 1) return null;
  const docResult = detailed.paragraphs[0];
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
    if (rollPool) rollPool.value = tiedCols.slice();
  } else if (docResult === RANDOM_ALL_SENTINEL) {
    // Random of every option in the aggregate's column set. May roll a
    // non-tied option, which the post-resolve `tiedCols.includes`
    // check below will reject (chip evaluates false in that case).
    if (cols.length === 0) return null;
    resolved = cols[Math.floor(Math.random() * cols.length)];
    if (fromRandom) fromRandom.value = true;
    if (rollPool) rollPool.value = cols.slice();
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
 *
 * `rollPool` is the option set the random was picked from (tied set
 * for tied/legacy random; entire column set for random_all). UIs
 * caching prior rolls use it to invalidate the cache when scores
 * shift the tied set out from under the cached value.
 */
export interface AggregateResolution {
  value: string | null;
  fromRandom: boolean;
  rollPool?: string[];
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
    const aref = variable.aggregate_ref;
    if (!aref) continue;
    // Set-membership refs don't have scoring tiebreaks to pre-resolve.
    if (aref === "nation_tiebreak_set") continue;
    const ref: ScoringAggregateRef = aref;
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
    const rollPool: { value: string[] | null } = { value: null };
    const resolved = resolveTieInline(
      ref,
      side,
      cols,
      tiedCols,
      selections,
      new Set(),
      fromRandom,
      rollPool
    );
    const valid = resolved && tiedCols.includes(resolved);
    out.set(key, {
      value: valid ? resolved : null,
      fromRandom: fromRandom.value,
      rollPool: rollPool.value ?? undefined,
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
    const aref = variable.aggregate_ref;
    if (!aref) continue;
    if (aref === "nation_tiebreak_set") continue;
    const ref: ScoringAggregateRef = aref;
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
  /** Optional. Used by `substituteVariables` to resolve `@[Name]` tokens
   *  in text-block bodies. Callers that don't care about substitution
   *  (static analysis, non-preview tests) can omit. */
  values?: EndingVariableValue[];
}

interface Indexes {
  byParent: Map<string, EvalBlock[]>;
  rowsByBlock: Map<string, EvalRow[]>;
  chipsByRow: Map<string, EvalChip[]>;
  variableById: Map<string, EvalVariable>;
  /** Name → variable, for `@[Name]` substitution. Empty when no variables
   *  share a name (which is enforced by the DB UNIQUE constraint). */
  variableByName: Map<string, EvalVariable>;
  /** ending_variable_values.id → .value (display label). Empty when
   *  EvalInputs.values is omitted. */
  valuesById: Map<string, string>;
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
  const variableByName = new Map<string, EvalVariable>();
  for (const v of input.variables) {
    variableById.set(v.id, v);
    variableByName.set(v.name, v);
  }

  const valuesById = new Map<string, string>();
  for (const v of input.values ?? []) valuesById.set(v.id, v.value);

  return {
    byParent,
    rowsByBlock,
    chipsByRow,
    variableById,
    variableByName,
    valuesById,
  };
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
 *
 * `options.initialTiebreakSet` switches the document to set-narrowing
 * semantics — used only by nation tiebreak docs. Condition blocks
 * walk every row in order (instead of first-match-wins), each row's
 * effects apply, `__remove__:X` result leaves drop nations from the
 * working set, `__random_remaining__` rolls from what survives, and
 * the doc auto-resolves when the working set has size 1.
 */
export function evaluateDocument(
  input: EvalInputs,
  options?: { initialTiebreakSet?: readonly string[] }
): string[] {
  return evaluateDocumentInternal(input, new Set(), options);
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
  evaluatingDocs: Set<EndingLogicKind>,
  options?: { initialTiebreakSet?: readonly string[] }
): string[] {
  const detailed = evaluateDocumentDetailedInternal(
    input,
    evaluatingDocs,
    options
  );
  // Eagerly expand a deferred random sentinel for runtime callers that
  // expect a concrete result. Preview callers consume the detailed shape
  // directly so they can offer a reroll button.
  if (
    detailed.rollSentinel != null &&
    detailed.rollPool &&
    detailed.rollPool.length > 0
  ) {
    return [
      detailed.rollPool[Math.floor(Math.random() * detailed.rollPool.length)],
    ];
  }
  return detailed.paragraphs;
}

/**
 * Like `evaluateDocument` but exposes the rollPool when the resolved
 * result is a random sentinel — used by the preview UI to surface a
 * reroll button. The non-narrowing path returns rollPool=null because
 * its sentinels carry their pool implicitly (preview infers via
 * `rollPoolForSentinel`); the narrowing path returns the final
 * working-set snapshot from inside the evaluator.
 */
export interface DocumentEvaluation {
  paragraphs: string[];
  rollSentinel: string | null;
  rollPool: string[] | null;
}

export function evaluateDocumentDetailed(
  input: EvalInputs,
  options?: { initialTiebreakSet?: readonly string[] }
): DocumentEvaluation {
  return evaluateDocumentDetailedInternal(input, new Set(), options);
}

function evaluateDocumentDetailedInternal(
  input: EvalInputs,
  evaluatingDocs: Set<EndingLogicKind>,
  options?: { initialTiebreakSet?: readonly string[] }
): DocumentEvaluation {
  if (options?.initialTiebreakSet) {
    const narrow = evaluateNarrowing(
      input,
      evaluatingDocs,
      options.initialTiebreakSet
    );
    return {
      paragraphs:
        narrow.rollSentinel != null
          ? [narrow.rollSentinel]
          : narrow.paragraphs,
      rollSentinel: narrow.rollSentinel,
      rollPool: narrow.rollPool,
    };
  }
  const indexes = buildIndexes(input);
  const root = indexes.byParent.get(parentKey(null, null)) ?? [];
  const result = renderBlocks(root, indexes, input.selections, evaluatingDocs);
  if (result.paragraphs.length > 0) {
    return {
      paragraphs: result.paragraphs,
      rollSentinel: null,
      rollPool: null,
    };
  }
  const fallback = root.find((b) => b.block_type === "fallback");
  if (fallback?.result_value != null && fallback.result_value !== "") {
    return {
      paragraphs: [fallback.result_value],
      rollSentinel: null,
      rollPool: null,
    };
  }
  return { paragraphs: [], rollSentinel: null, rollPool: null };
}

/**
 * Set-narrowing evaluation for nation tiebreak docs. Walks the doc
 * in document order, lets matching condition rows apply their
 * effects (`__remove__:X` shrinks the working set; definite results
 * return immediately), auto-resolves when the working set collapses
 * to a single nation, and falls through to the fallback when the
 * tree finishes without picking.
 */
interface NarrowResolution {
  paragraphs: string[];
  rollSentinel: string | null;
  rollPool: string[] | null;
}

type SentinelExpansion =
  | { kind: "value"; value: string }
  | { kind: "deferred"; sentinel: string; pool: string[] }
  | { kind: "empty" };

function evaluateNarrowing(
  input: EvalInputs,
  evaluatingDocs: Set<EndingLogicKind>,
  initialTiebreakSet: readonly string[]
): NarrowResolution {
  const workingSet = new Set<string>(initialTiebreakSet);
  const selections: PreviewSelections = {
    ...input.selections,
    tiebreakWorkingSet: workingSet,
  };
  const indexes = buildIndexes(input);
  const root = indexes.byParent.get(parentKey(null, null)) ?? [];
  const picked = renderNarrow(
    root,
    indexes,
    selections,
    workingSet,
    evaluatingDocs
  );
  if (picked.kind === "value") {
    return { paragraphs: [picked.value], rollSentinel: null, rollPool: null };
  }
  if (picked.kind === "deferred") {
    return {
      paragraphs: [],
      rollSentinel: picked.sentinel,
      rollPool: picked.pool,
    };
  }
  if (workingSet.size === 1) {
    return { paragraphs: [...workingSet], rollSentinel: null, rollPool: null };
  }
  // Tree exhausted without picking. Fall through to fallback if any.
  const fallback = root.find((b) => b.block_type === "fallback");
  if (fallback?.result_value != null && fallback.result_value !== "") {
    const expanded = expandTerminalSentinel(fallback.result_value, workingSet);
    if (expanded.kind === "value") {
      return { paragraphs: [expanded.value], rollSentinel: null, rollPool: null };
    }
    if (expanded.kind === "deferred") {
      return {
        paragraphs: [],
        rollSentinel: expanded.sentinel,
        rollPool: expanded.pool,
      };
    }
  }
  return { paragraphs: [], rollSentinel: null, rollPool: null };
}

function renderNarrow(
  blocks: EvalBlock[],
  indexes: Indexes,
  selections: PreviewSelections,
  workingSet: Set<string>,
  evaluatingDocs: Set<EndingLogicKind>
): SentinelExpansion {
  for (const b of blocks) {
    if (b.block_type === "fallback") continue;
    if (b.block_type === "text") continue;
    if (b.block_type === "result") {
      const v = b.result_value;
      if (v == null || v === "") continue;
      const removeNation = parseRemoveSentinel(v);
      if (removeNation != null) {
        workingSet.delete(removeNation);
        if (workingSet.size === 0) return { kind: "empty" };
        if (workingSet.size === 1) {
          return { kind: "value", value: [...workingSet][0] };
        }
        continue;
      }
      const expanded = expandTerminalSentinel(v, workingSet);
      if (expanded.kind !== "empty") return expanded;
      // empty: empty pool or unresolvable sentinel. Skip to next sibling.
      continue;
    }
    // Condition block: evaluate ALL matching rows in order, applying
    // their child blocks' effects each time. Stops as soon as a
    // descendant returns a definite result, the working set hits 1,
    // or the working set hits 0.
    const rows = indexes.rowsByBlock.get(b.id) ?? [];
    for (const row of rows) {
      const chips = indexes.chipsByRow.get(row.id) ?? [];
      if (
        !evaluateRow(chips, indexes.variableById, selections, evaluatingDocs)
      ) {
        continue;
      }
      const children = indexes.byParent.get(parentKey(b.id, row.id)) ?? [];
      const r = renderNarrow(
        children,
        indexes,
        selections,
        workingSet,
        evaluatingDocs
      );
      if (r.kind !== "empty") return r;
      if (workingSet.size === 0) return { kind: "empty" };
      if (workingSet.size === 1) {
        return { kind: "value", value: [...workingSet][0] };
      }
    }
  }
  return { kind: "empty" };
}

function expandTerminalSentinel(
  value: string,
  workingSet: Set<string>
): SentinelExpansion {
  if (
    value === RANDOM_REMAINING_SENTINEL ||
    value === RANDOM_TIED_SENTINEL ||
    value === RANDOM_RESULT_SENTINEL ||
    // In narrowing mode, "all" still means the original aggregate's
    // option set — but we no longer have direct access to it here.
    // Fall back to the working set, which is a strict subset.
    value === RANDOM_ALL_SENTINEL
  ) {
    if (workingSet.size === 0) return { kind: "empty" };
    return { kind: "deferred", sentinel: value, pool: [...workingSet] };
  }
  if (parseRemoveSentinel(value) != null) {
    // A `__remove__:X` value as a fallback or terminal result is
    // meaningless — there's nothing left to walk. Treat as unresolved.
    return { kind: "empty" };
  }
  // Definite nation/value.
  return { kind: "value", value };
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
      if (trimmed.length > 0) {
        out.push(
          substituteVariables(b.text, {
            variableByName: indexes.variableByName,
            selections,
            valuesById: indexes.valuesById,
          })
        );
      }
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
