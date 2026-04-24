import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  EndingFramework,
  EndingFrameworkBlock,
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
    { data: logicCondData },
  ] = await Promise.all([
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
    supabase.from("ending_frameworks").select("*").order("sort_order"),
    supabase
      .from("ending_framework_blocks")
      .select("framework_id, variable_id, block_type"),
    supabase.from("ending_logic_rule_conditions").select("variable_id"),
  ]);

  return (
    <VariablesEditor
      variables={(varData ?? []) as EndingVariable[]}
      values={(valueData ?? []) as EndingVariableValue[]}
      frameworks={(frameworkData ?? []) as EndingFramework[]}
      frameworkBlocks={
        (blockData ?? []) as Array<
          Pick<EndingFrameworkBlock, "framework_id" | "variable_id" | "block_type">
        >
      }
      logicConditions={
        (logicCondData ?? []) as Array<Pick<EndingLogicRuleCondition, "variable_id">>
      }
    />
  );
}
