import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type {
  City,
  Day,
  EndingVariable,
  Nation,
  SortingRule,
  SortingRuleCondition,
  Storyline,
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
    { data: sData },
    { data: vData },
  ] = await Promise.all([
    supabase
      .from("sorting_rules")
      .select("*")
      .order("sort_order")
      .order("letter"),
    supabase.from("sorting_rule_conditions").select("*").order("position"),
    supabase.from("days").select("*").order("number"),
    supabase.from("nations").select("*").order("sort_order"),
    supabase.from("cities").select("*").order("name"),
    supabase.from("storylines").select("*").order("sort_order"),
    supabase.from("ending_variables").select("*").order("sort_order"),
  ]);
  const rules = (rData ?? []) as SortingRule[];
  const allConditions = (cData ?? []) as SortingRuleCondition[];
  const days = (dData ?? []) as Day[];
  const nations = (nData ?? []) as Nation[];
  const cities = (ctData ?? []) as City[];
  const storylines = (sData ?? []) as Storyline[];
  const endingVariables = (vData ?? []) as EndingVariable[];
  const conditionsByRule: Record<string, SortingRuleCondition[]> = {};
  for (const c of allConditions) {
    (conditionsByRule[c.rule_id] ??= []).push(c);
  }

  // ?rule=<letter> deep-links a rule; resolve it to an id for the workspace.
  // When no deep-link is set, default to the first rule (sorted order) so the
  // panel isn't blank on first visit.
  const initialSelectedRuleId = ruleParam
    ? (rules.find((r) => r.letter === ruleParam.toUpperCase())?.id ?? null)
    : (rules[0]?.id ?? null);

  return (
    <div className="font-mono">
      <PageHeader
        title="Sorting Rules"
        description="On conflict, most recently implemented rule takes precedence."
      />

      <RulesList
        rules={rules}
        conditionsByRule={conditionsByRule}
        days={days}
        nations={nations}
        cities={cities}
        storylines={storylines}
        endingVariables={endingVariables}
        initialSelectedRuleId={initialSelectedRuleId}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />
    </div>
  );
}
