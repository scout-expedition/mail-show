import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ActionRow,
  ActionTemplate,
  Citizen,
  City,
  Day,
  InspectionLetterView,
  LetterGroup,
  Nation,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { parseGroupSlug } from "@/lib/letter-groups";
import { LettersWorkspace } from "./workspace";

export default async function InspectionLettersPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; letter?: string }>;
}) {
  const { group: groupParam, letter: letterParam } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const [
    { data: sData },
    { data: gData },
    { data: dData },
    { data: lData },
    { data: actionsData },
    { data: templatesData },
    { data: citizensData },
    { data: allCitizenIdsData },
    { data: citiesData },
    { data: nationsData },
    { data: segmentsData },
  ] = await Promise.all([
    supabase.from("storylines").select("*").order("sort_order"),
    supabase.from("letter_groups").select("*").order("sequence"),
    supabase.from("days").select("*").order("number"),
    supabase
      .from("inspection_letters_view")
      .select("*")
      .order("variant", { ascending: true, nullsFirst: true })
      .order("piece", { ascending: true, nullsFirst: true }),
    supabase.from("actions").select("*").order("sort_order"),
    supabase.from("action_templates").select("*").order("sort_order"),
    supabase.from("citizens").select("*").eq("type", "hero").order("name"),
    supabase.from("citizens").select("citizen_id").not("citizen_id", "is", null),
    supabase.from("cities").select("*"),
    supabase.from("nations").select("*"),
    supabase.from("report_segments_view").select("*"),
  ]);

  const storylines = (sData ?? []) as Storyline[];
  const groups = (gData ?? []) as LetterGroup[];
  const days = (dData ?? []) as Day[];
  const letters = (lData ?? []) as InspectionLetterView[];
  const allActions = (actionsData ?? []) as ActionRow[];
  const templates = (templatesData ?? []) as ActionTemplate[];
  const heroes = (citizensData ?? []) as Citizen[];
  const allCitizenIds = ((allCitizenIdsData ?? []) as Array<{
    citizen_id: string | null;
  }>)
    .map((r) => r.citizen_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  const cities = (citiesData ?? []) as City[];
  const nations = (nationsData ?? []) as Nation[];
  const segments = (segmentsData ?? []) as ReportSegmentView[];

  // Resolve ?group=<slug> → group id for initial selection.
  let initialGroupId: string | null = null;
  if (groupParam) {
    const parsed = parseGroupSlug(groupParam);
    if (parsed) {
      const s = storylines.find((s) => s.abbreviation === parsed.abbreviation);
      if (s) {
        const g = groups.find(
          (g) => g.storyline_id === s.id && g.sequence === parsed.sequence
        );
        if (g) initialGroupId = g.id;
      }
    }
  }

  return (
    <LettersWorkspace
      storylines={storylines}
      groups={groups}
      days={days}
      letters={letters}
      actions={allActions}
      templates={templates}
      heroes={heroes}
      allCitizenIds={allCitizenIds}
      cities={cities}
      nations={nations}
      segments={segments}
      initialGroupId={initialGroupId}
      initialLetterHint={letterParam ?? null}
    />
  );
}
