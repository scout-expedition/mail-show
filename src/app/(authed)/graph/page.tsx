import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ActionRow,
  ActionTemplate,
  Citizen,
  City,
  Day,
  EndingVariable,
  EndingVariableValue,
  InspectionActionEndingAssignment,
  InspectionLetterView,
  LetterGroup,
  Nation,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { profileFromMetadata } from "@/lib/auth/profile";
import { GraphSurface } from "./graph-surface";
import { sweepOrphanActionRefs } from "../inspection/letters/actions";

export default async function GraphPage() {
  const supabase = await createSupabaseServerClient();
  await sweepOrphanActionRefs();
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
    { data: sData },
    { data: gData },
    { data: lData },
    { data: aData },
    { data: dData },
    { data: rData },
    { data: tData },
    { data: nData },
    { data: eaData },
    { data: heroesData },
    { data: allCitizenIdsData },
    { data: citiesData },
    { data: endingVarData },
    { data: endingValueData },
  ] = await Promise.all([
    supabase.from("storylines").select("*").order("sort_order"),
    supabase.from("letter_groups").select("*").order("sequence"),
    supabase
      .from("inspection_letters_view")
      .select("*")
      .order("variant", { ascending: true, nullsFirst: true })
      .order("piece", { ascending: true, nullsFirst: true }),
    supabase.from("actions").select("*").order("sort_order"),
    supabase.from("days").select("*").order("number"),
    supabase.from("report_segments_view").select("*"),
    supabase.from("action_templates").select("*").order("sort_order"),
    supabase.from("nations").select("*").order("sort_order"),
    supabase.from("inspection_action_ending_assignments").select("*"),
    supabase.from("citizens").select("*").eq("type", "hero").order("name"),
    supabase.from("citizens").select("citizen_id").not("citizen_id", "is", null),
    supabase.from("cities").select("*"),
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
  ]);
  const storylines = (sData ?? []) as Storyline[];
  const letterGroups = (gData ?? []) as LetterGroup[];
  const letters = (lData ?? []) as InspectionLetterView[];
  const actions = (aData ?? []) as ActionRow[];
  const days = (dData ?? []) as Day[];
  const segments = (rData ?? []) as ReportSegmentView[];
  const actionTemplates = (tData ?? []) as ActionTemplate[];
  const nations = (nData ?? []) as Nation[];
  const endingAssignments = (eaData ?? []) as InspectionActionEndingAssignment[];
  const heroes = (heroesData ?? []) as Citizen[];
  const allCitizenIds = ((allCitizenIdsData ?? []) as Array<{
    citizen_id: string | null;
  }>)
    .map((r) => r.citizen_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const cities = (citiesData ?? []) as City[];
  const endingVariables = (endingVarData ?? []) as EndingVariable[];
  const endingValues = (endingValueData ?? []) as EndingVariableValue[];

  return (
    <GraphSurface
      storylines={storylines}
      letterGroups={letterGroups}
      letters={letters}
      actions={actions}
      actionTemplates={actionTemplates}
      days={days}
      segments={segments}
      nations={nations}
      endingAssignments={endingAssignments}
      heroes={heroes}
      allCitizenIds={allCitizenIds}
      cities={cities}
      endingVariables={endingVariables}
      endingValues={endingValues}
      currentUserId={currentUserId}
      currentEmail={currentEmail}
      currentProfile={presenceProfile}
    />
  );
}
