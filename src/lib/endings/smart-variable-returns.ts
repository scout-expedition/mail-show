// Per-smart-variable list of unique result strings — fed into chip
// pickers so smart_ref chips have a real value dropdown and the
// condition-block chip-adder can seed a default `aggregate_value`.
//
// Keyed by the paired smart_ref variable's id (NOT the doc's id) so
// callers can look up by `chip.variable_id` directly.
//
// Ordering: values that show up on at least one condition-result block
// come first (alpha-sorted by lowercase), then values that ONLY come
// from the fallback block (alpha-sorted). The split puts unreachable-
// without-fallback returns at the bottom of the chip dropdown, since
// those only fire when no condition matched.
//
// Centralised here so frameworks, logic, and the Smart Variables
// editor itself all derive returns the same way.

import type {
  EndingBlock,
  EndingDocument,
  EndingVariable,
} from "@/lib/db/types";

function pushNonEmpty(set: Set<string>, value: string | null | undefined) {
  if (value == null) return;
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  set.add(trimmed);
}

function sortAlpha(values: Iterable<string>): string[] {
  return [...values].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
}

export function buildSmartReturnsByVariable(
  docs: EndingDocument[],
  variables: EndingVariable[],
  blocks: EndingBlock[]
): Map<string, string[]> {
  const variableIdByDoc = new Map<string, string>();
  for (const v of variables) {
    if (v.kind !== "smart_ref" || !v.smart_variable_doc_id) continue;
    variableIdByDoc.set(v.smart_variable_doc_id, v.id);
  }
  const out = new Map<string, string[]>();
  for (const doc of docs) {
    if (doc.kind !== "smart_variable") continue;
    const variableId = variableIdByDoc.get(doc.id);
    if (!variableId) continue;
    const docBlocks = blocks.filter((b) => b.document_id === doc.id);
    const conditionResults = new Set<string>();
    const fallbackResults = new Set<string>();
    for (const b of docBlocks) {
      if (b.block_type === "result") {
        pushNonEmpty(conditionResults, b.result_value);
      } else if (b.block_type === "fallback") {
        pushNonEmpty(fallbackResults, b.result_value);
      }
    }
    // Fallback values that ALSO show up in a condition result stay in
    // the condition block — those are reachable without hitting the
    // fallback. Only values whose sole producer is the fallback get
    // demoted to the bottom of the list.
    const fallbackOnly = new Set<string>();
    for (const v of fallbackResults) {
      if (!conditionResults.has(v)) fallbackOnly.add(v);
    }
    out.set(variableId, [
      ...sortAlpha(conditionResults),
      ...sortAlpha(fallbackOnly),
    ]);
  }
  return out;
}
