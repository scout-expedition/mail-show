"use client";

import { createContext, useContext } from "react";
import type {
  BlockAnalysis,
  NumericRowOverlap,
  ShadowedRow,
} from "@/lib/endings/static-analysis";

/**
 * Static-analysis output for the current framework. Provided by
 * `framework-editor.tsx` and consumed by ConditionBlock / ConditionRow
 * for shadow + uncovered-assignment badges. Defaults to empty so callers
 * outside the editor (e.g. tests) work without a provider.
 */
export interface AnalysisContext {
  /** row_id → covered_by_row_id (the earlier row that fully covers it). */
  shadowByRowId: Map<string, string>;
  /** row_id → numeric overlap analysis (single-numeric-var blocks only). */
  overlapByRowId: Map<string, NumericRowOverlap>;
  /** condition_block_id → BlockAnalysis. */
  blockAnalysis: Map<string, BlockAnalysis>;
  /** Sort_order index for each row id, so the UI can render "row N". */
  rowSortOrder: Map<string, number>;
}

export const EMPTY_ANALYSIS: AnalysisContext = {
  shadowByRowId: new Map(),
  overlapByRowId: new Map(),
  blockAnalysis: new Map(),
  rowSortOrder: new Map(),
};

export const AnalysisCtx = createContext<AnalysisContext>(EMPTY_ANALYSIS);

export function useAnalysis(): AnalysisContext {
  return useContext(AnalysisCtx);
}

export function indexShadow(rows: ShadowedRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.shadowed_row_id, r.covered_by_row_id);
  return m;
}

export function indexOverlap(
  overlaps: NumericRowOverlap[]
): Map<string, NumericRowOverlap> {
  const m = new Map<string, NumericRowOverlap>();
  for (const o of overlaps) m.set(o.row_id, o);
  return m;
}
