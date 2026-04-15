import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SortingRule, SortingRuleCondition } from "@/lib/db/types";
import { createRule } from "./actions";
import { RulesList } from "./rules-list";

export default async function RulesPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: rData }, { data: cData }] = await Promise.all([
    supabase.from("sorting_rules").select("*").order("letter"),
    supabase.from("sorting_rule_conditions").select("*").order("position"),
  ]);
  const rules = (rData ?? []) as SortingRule[];
  const allConditions = (cData ?? []) as SortingRuleCondition[];
  const conditionsByRule: Record<string, SortingRuleCondition[]> = {};
  for (const c of allConditions) {
    (conditionsByRule[c.rule_id] ??= []).push(c);
  }

  return (
    <div>
      <PageHeader
        title="Sorting Rules"
        description="Up to 26 rules (RR-A through RR-Z). Newer rules trump older on conflicts."
      />

      <RulesList rules={rules} conditionsByRule={conditionsByRule} />

      <div className="mt-4 flex justify-center">
        <form action={createRule}>
          <Button type="submit" variant="outline" size="sm" disabled={rules.length >= 26}>
            + Rule
          </Button>
        </form>
      </div>
    </div>
  );
}
