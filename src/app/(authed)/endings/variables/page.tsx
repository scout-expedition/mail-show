import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  EndingFramework,
  EndingLogicRuleCondition,
  EndingVariable,
  EndingVariableValue,
} from "@/lib/db/types";
import { VariablesEditor } from "./variables-editor";

export default async function EndingVariablesPage() {
  const supabase = await createSupabaseServerClient();
  const [
    { data: varData },
    { data: valueData },
    { data: frameworkData },
    { data: blockData },
    { data: rowData },
    { data: chipData },
    { data: logicCondData },
  ] = await Promise.all([
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
    supabase.from("ending_frameworks").select("*").order("sort_order"),
    supabase.from("ending_framework_blocks").select("id, framework_id"),
    supabase.from("ending_condition_rows").select("id, condition_block_id"),
    supabase.from("ending_condition_row_chips").select("variable_id, row_id"),
    supabase.from("ending_logic_rule_conditions").select("variable_id"),
  ]);

  // Derive (framework_id, variable_id) pairs by walking chip → row → block.
  const blockToFramework = new Map<string, string>();
  for (const b of (blockData ?? []) as Array<{
    id: string;
    framework_id: string;
  }>) {
    blockToFramework.set(b.id, b.framework_id);
  }
  const rowToFramework = new Map<string, string>();
  for (const r of (rowData ?? []) as Array<{
    id: string;
    condition_block_id: string;
  }>) {
    const fid = blockToFramework.get(r.condition_block_id);
    if (fid) rowToFramework.set(r.id, fid);
  }
  const frameworkVariableRefs: Array<{
    framework_id: string;
    variable_id: string;
  }> = [];
  const seen = new Set<string>();
  for (const c of (chipData ?? []) as Array<{
    variable_id: string;
    row_id: string;
  }>) {
    const fid = rowToFramework.get(c.row_id);
    if (!fid) continue;
    const key = `${fid}:${c.variable_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    frameworkVariableRefs.push({
      framework_id: fid,
      variable_id: c.variable_id,
    });
  }

  return (
    <VariablesEditor
      variables={(varData ?? []) as EndingVariable[]}
      values={(valueData ?? []) as EndingVariableValue[]}
      frameworks={(frameworkData ?? []) as EndingFramework[]}
      frameworkVariableRefs={frameworkVariableRefs}
      logicConditions={
        (logicCondData ?? []) as Array<Pick<EndingLogicRuleCondition, "variable_id">>
      }
    />
  );
}
