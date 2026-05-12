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
import { parseGroupSlug } from "@/lib/letter-groups";
import { LettersWorkspace } from "./workspace";

export default async function InspectionLettersPage({
  searchParams,
}: {
  searchParams: Promise<{
    group?: string;
    letter?: string;
    report?: string;
  }>;
}) {
  const {
    group: groupParam,
    letter: letterParam,
    report: reportParam,
  } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: meData } = await supabase.auth.getUser();
  const currentUserId = meData.user?.id;
  const currentEmail = meData.user?.email;
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
    { data: endingVarData },
    { data: endingValueData },
    { data: endingAssignmentData },
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
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
    supabase.from("inspection_action_ending_assignments").select("*"),
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
  const endingVariables = (endingVarData ?? []) as EndingVariable[];
  const endingValues = (endingValueData ?? []) as EndingVariableValue[];
  const endingAssignments = (endingAssignmentData ??
    []) as InspectionActionEndingAssignment[];

  // Resolve ?group=<slug>, ?letter=<slug>/<variant>, ?report=<slug>/<variant>
  // into initial ids. `?letter` and `?report` imply their containing group.
  let initialGroupId: string | null = null;
  let initialLetterId: string | null = null;
  let initialSegmentId: string | null = null;

  function resolveSlugToGroup(slug: string): LetterGroup | null {
    const parsed = parseGroupSlug(slug);
    if (!parsed) return null;
    const s = storylines.find((s) => s.abbreviation === parsed.abbreviation);
    if (!s) return null;
    return (
      groups.find(
        (g) => g.storyline_id === s.id && g.sequence === parsed.sequence
      ) ?? null
    );
  }

  function splitSlash(v: string): { slug: string; variant: string } | null {
    const idx = v.indexOf("/");
    if (idx < 0) return null;
    return { slug: v.slice(0, idx), variant: v.slice(idx + 1) };
  }

  if (reportParam) {
    const parts = splitSlash(reportParam);
    if (parts) {
      const g = resolveSlugToGroup(parts.slug);
      if (g) {
        initialGroupId = g.id;
        const seg = segments.find(
          (s) => s.letter_group_id === g.id && s.variant === parts.variant
        );
        if (seg) {
          initialSegmentId = seg.id;
          // Also resolve a triggering letter so the breadcrumb chain
          // (group → letter → actions → segment) has every step. Prefer
          // a trigger in the same letter group; fall back to any action
          // that points at this segment.
          const trigger =
            allActions.find((a) => {
              if (a.report_segment_id !== seg.id) return false;
              const l = letters.find((x) => x.id === a.inspection_letter_id);
              return l?.letter_group_id === g.id;
            }) ??
            allActions.find((a) => a.report_segment_id === seg.id) ??
            null;
          if (trigger) initialLetterId = trigger.inspection_letter_id;
        }
      }
    }
  } else if (letterParam && letterParam !== "none") {
    const parts = splitSlash(letterParam);
    if (parts) {
      const g = resolveSlugToGroup(parts.slug);
      if (g) {
        initialGroupId = g.id;
        const letter = letters.find(
          (l) => l.letter_group_id === g.id && l.variant === parts.variant
        );
        if (letter) initialLetterId = letter.id;
      }
    }
  } else if (groupParam) {
    const g = resolveSlugToGroup(groupParam);
    if (g) initialGroupId = g.id;
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
      endingVariables={endingVariables}
      endingValues={endingValues}
      endingAssignments={endingAssignments}
      initialGroupId={initialGroupId}
      initialLetterId={initialLetterId}
      initialSegmentId={initialSegmentId}
      currentUserId={currentUserId}
      currentEmail={currentEmail}
    />
  );
}
