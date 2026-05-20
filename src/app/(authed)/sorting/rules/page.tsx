import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type {
  City,
  Day,
  Nation,
  SortingRule,
  SortingRuleCondition,
} from "@/lib/db/types";
import { RulesList } from "./rules-list";

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ rule?: string }>;
}) {
  const { rule: ruleParam } = await searchParams;
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

  const [
    { data: rData },
    { data: cData },
    { data: dData },
    { data: nData },
    { data: ctData },
  ] = await Promise.all([
    supabase.from("sorting_rules").select("*").order("letter"),
    supabase.from("sorting_rule_conditions").select("*").order("position"),
    supabase.from("days").select("*").order("number"),
    supabase.from("nations").select("*").order("sort_order"),
    supabase.from("cities").select("*").order("name"),
  ]);
  const rules = (rData ?? []) as SortingRule[];
  const allConditions = (cData ?? []) as SortingRuleCondition[];
  const days = (dData ?? []) as Day[];
  const nations = (nData ?? []) as Nation[];
  const cities = (ctData ?? []) as City[];
  const conditionsByRule: Record<string, SortingRuleCondition[]> = {};
  for (const c of allConditions) {
    (conditionsByRule[c.rule_id] ??= []).push(c);
  }

  // ?rule=<letter> deep-links a rule; resolve it to an id for the workspace.
  const initialSelectedRuleId = ruleParam
    ? (rules.find((r) => r.letter === ruleParam.toUpperCase())?.id ?? null)
    : null;

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
        nations={nations}
        cities={cities}
        initialSelectedRuleId={initialSelectedRuleId}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />
    </div>
  );
}
