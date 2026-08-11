import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type {
  Citizen,
  City,
  Day,
  Nation,
  SortingLetterView,
  SortingRule,
  SortingRuleCondition,
} from "@/lib/db/types";
import { SortingLettersEditor } from "./sorting-letters-editor";

export default async function SortingLettersPage({
  searchParams,
}: {
  searchParams: Promise<{ letter?: string }>;
}) {
  const { letter: letterParam } = await searchParams;
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

  // Rules + the citizen directory come down with the letters: the destination
  // column is computed client-side from exactly the same inputs the rule
  // evaluator uses, so it stays live as letters are edited.
  const [
    { data: daysData },
    { data: lettersData },
    { data: rulesData },
    { data: conditionsData },
    { data: citizensData },
    { data: citiesData },
    { data: nationsData },
  ] = await Promise.all([
    supabase.from("days").select("*").order("number"),
    supabase
      .from("sorting_letters_view")
      .select("*")
      .order("day_number")
      .order("sort_id"),
    supabase.from("sorting_rules").select("*").order("sort_order").order("letter"),
    supabase.from("sorting_rule_conditions").select("*").order("position"),
    supabase.from("citizens").select("*").order("last_name").order("first_name"),
    supabase.from("cities").select("*").order("name"),
    supabase.from("nations").select("*").order("sort_order"),
  ]);

  const days = (daysData ?? []) as Day[];
  const letters = (lettersData ?? []) as SortingLetterView[];
  const rules = (rulesData ?? []) as SortingRule[];
  const ruleConditions = (conditionsData ?? []) as SortingRuleCondition[];
  const citizens = (citizensData ?? []) as Citizen[];
  const cities = (citiesData ?? []) as City[];
  const nations = (nationsData ?? []) as Nation[];

  // ?letter=<id> deep-links the editor panel. An id that no longer exists
  // resolves to no selection rather than a 404.
  const initialSelectedId =
    letterParam && letters.some((l) => l.id === letterParam) ? letterParam : null;

  return (
    <div>
      <PageHeader
        title="Sorting Letters"
        description="Letters the player must sort during the sorting phase of each day."
      />

      <SortingLettersEditor
        letters={letters}
        days={days}
        rules={rules}
        ruleConditions={ruleConditions}
        citizens={citizens}
        cities={cities}
        nations={nations}
        initialSelectedId={initialSelectedId}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />
    </div>
  );
}
