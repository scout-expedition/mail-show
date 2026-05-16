import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type { Day, SortingRule, SortingRuleCondition } from "@/lib/db/types";
import { createRule } from "./actions";
import { RulesList } from "./rules-list";

export default async function RulesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: meData } = await supabase.auth.getUser();
  const currentUserId = meData.user?.id;
  const currentEmail = meData.user?.email;
  const meProfile = profileFromMetadata(meData.user?.user_metadata);
  const presenceProfile = {
    displayName: meProfile.display_name,
    avatarIconType: meProfile.avatar_icon_type,
    avatarIconValue: meProfile.avatar_icon_value,
    avatarColorHex: meProfile.avatar_color_hex,
  };

  const [{ data: rData }, { data: cData }, { data: dData }] = await Promise.all([
    supabase.from("sorting_rules").select("*").order("letter"),
    supabase.from("sorting_rule_conditions").select("*").order("position"),
    supabase.from("days").select("*").order("number"),
  ]);
  const rules = (rData ?? []) as SortingRule[];
  const allConditions = (cData ?? []) as SortingRuleCondition[];
  const days = (dData ?? []) as Day[];
  const conditionsByRule: Record<string, SortingRuleCondition[]> = {};
  for (const c of allConditions) {
    (conditionsByRule[c.rule_id] ??= []).push(c);
  }

  return (
    <div className="font-mono">
      <PageHeader
        title="Sorting Rules"
        description="Up to 26 rules (RR-A through RR-Z). Newer rules trump older on conflicts."
      />

      <RulesList
        rules={rules}
        conditionsByRule={conditionsByRule}
        days={days}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />

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
