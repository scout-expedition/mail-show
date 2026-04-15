import { notFound } from "next/navigation";
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
  Storyline,
} from "@/lib/db/types";
import { GroupEditor } from "./editor";

export default async function GroupEditorPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const supabase = await createSupabaseServerClient();
  const [
    { data: gData },
    { data: sData },
    { data: daysData },
    { data: lettersData },
    { data: actionsData },
    { data: templatesData },
    { data: citizensData },
    { data: citiesData },
    { data: nationsData },
  ] = await Promise.all([
    supabase.from("letter_groups").select("*").eq("id", groupId).maybeSingle(),
    supabase.from("storylines").select("*").order("sort_order"),
    supabase.from("days").select("*").order("number"),
    supabase
      .from("inspection_letters_view")
      .select("*")
      .eq("letter_group_id", groupId)
      .order("variant", { ascending: true, nullsFirst: true })
      .order("piece", { ascending: true, nullsFirst: true }),
    supabase.from("actions").select("*").order("sort_order"),
    supabase.from("action_templates").select("*").order("sort_order"),
    supabase
      .from("citizens")
      .select("*")
      .eq("type", "hero")
      .order("name"),
    supabase.from("cities").select("*"),
    supabase.from("nations").select("*"),
  ]);
  if (!gData) notFound();
  const group = gData as LetterGroup;
  const storylines = (sData ?? []) as Storyline[];
  const days = (daysData ?? []) as Day[];
  const letters = (lettersData ?? []) as InspectionLetterView[];
  const allActions = (actionsData ?? []) as ActionRow[];
  const templates = (templatesData ?? []) as ActionTemplate[];
  const heroes = (citizensData ?? []) as Citizen[];
  const cities = (citiesData ?? []) as City[];
  const nations = (nationsData ?? []) as Nation[];

  const letterIds = new Set(letters.map((l) => l.id));
  const actionsForLetters = allActions.filter((a) =>
    letterIds.has(a.inspection_letter_id)
  );

  return (
    <GroupEditor
      group={group}
      storylines={storylines}
      days={days}
      letters={letters}
      actions={actionsForLetters}
      templates={templates}
      heroes={heroes}
      cities={cities}
      nations={nations}
    />
  );
}
