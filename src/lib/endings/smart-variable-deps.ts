import { AGGREGATE_OPTIONS_BY_REF } from "@/lib/db/enums";
import { extractVariableTagNames } from "@/lib/endings/text-substitution";
import type { BlockState, ChipState, VariableState } from "@/lib/endings/block-state";

export function referencedVariableIdsForDoc(opts: {
  blocks: ReadonlyArray<BlockState>;
  chips: ReadonlyArray<ChipState>;
  variables: ReadonlyArray<VariableState>;
}): Set<string> {
  const { blocks, chips, variables } = opts;
  const ids = new Set<string>();
  for (const c of chips) ids.add(c.variable_id);
  const variableByName = new Map<string, VariableState>();
  for (const v of variables) variableByName.set(v.name, v);
  for (const b of blocks) {
    if (b.block_type !== "text" || !b.text) continue;
    for (const name of extractVariableTagNames(b.text)) {
      const v = variableByName.get(name);
      if (v) ids.add(v.id);
    }
  }
  const numberRefByName = new Map<string, VariableState>();
  for (const v of variables) {
    if (v.kind === "number_ref" && v.number_ref) {
      numberRefByName.set(v.number_ref, v);
    }
  }
  for (const v of variables) {
    if (!ids.has(v.id)) continue;
    if (v.kind !== "aggregate_ref" || !v.aggregate_ref) continue;
    if (v.aggregate_ref === "nation_tiebreak_set") continue;
    for (const col of AGGREGATE_OPTIONS_BY_REF[v.aggregate_ref]) {
      const underlying = numberRefByName.get(col);
      if (underlying) ids.add(underlying.id);
    }
  }
  return ids;
}
