import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  EndingFramework,
  EndingLogicRule,
  EndingLogicRuleCondition,
  EndingVariable,
  EndingVariableValue,
} from "@/lib/db/types";
import { LogicEditor } from "./logic-editor";

export default async function EndingLogicPage() {
  const supabase = await createSupabaseServerClient();
  const [
    { data: ruleData },
    { data: condData },
    { data: frameworkData },
    { data: varData },
    { data: valueData },
  ] = await Promise.all([
    supabase.from("ending_logic_rules").select("*").order("sort_order"),
    supabase.from("ending_logic_rule_conditions").select("*"),
    supabase.from("ending_frameworks").select("*").order("sort_order"),
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
  ]);

  return (
    <LogicEditor
      rules={(ruleData ?? []) as EndingLogicRule[]}
      conditions={(condData ?? []) as EndingLogicRuleCondition[]}
      frameworks={(frameworkData ?? []) as EndingFramework[]}
      variables={(varData ?? []) as EndingVariable[]}
      values={(valueData ?? []) as EndingVariableValue[]}
    />
  );
}
