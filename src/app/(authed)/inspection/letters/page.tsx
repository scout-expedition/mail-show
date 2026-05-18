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
import { profileFromMetadata } from "@/lib/auth/profile";
import { LettersWorkspace } from "./workspace";
import { sweepOrphanActionRefs } from "./actions";

export default async function InspectionLettersPage({
  searchParams,
}: {
  searchParams: Promise<{
    group?: string;
    letter?: string;
    actions?: string;
    report?: string;
  }>;
}) {
  const {
    group: groupParam,
    letter: letterParam,
    actions: actionsParam,
    report: reportParam,
  } = await searchParams;
  const supabase = await createSupabaseServerClient();
  await sweepOrphanActionRefs();
  const { data: meData } = await supabase.auth.getUser();
  const currentUserId = meData.user?.id;
  const currentEmail = meData.user?.email;
  // Profile (display name + avatar icon/color) lives in user_metadata; pass
  // a presence-shaped object straight to the workspace so peers see the
  // same identity in the AvatarStack that the user sees in the nav.
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

  // Resolve ?group=<slug>, ?letter=<slug>-<variant>, ?actions=<slug>-<variant>,
  // ?report=<slug>-<variant> into initial ids. `?letter` / `?actions` / `?report`
  // imply their containing group.
  let initialGroupId: string | null = null;
  let initialLetterId: string | null = null;
  let initialSegmentId: string | null = null;
  let initialView: "actions" | null = null;

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

  // Split `<slug><sep><variant>` where slug is `[A-Z]\d+`. Hyphen is the
  // canonical separator; `/` is accepted as a legacy fallback for bookmarks
  // produced before the hyphen swap.
  function splitSlug(v: string): { slug: string; variant: string } | null {
    const m = /^([A-Z]\d+)[-/](.+)$/.exec(v);
    if (!m) return null;
    return { slug: m[1], variant: m[2] };
  }

  if (reportParam) {
    const parts = splitSlug(reportParam);
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
  } else if (actionsParam && actionsParam !== "none") {
    const parts = splitSlug(actionsParam);
    if (parts) {
      const g = resolveSlugToGroup(parts.slug);
      if (g) {
        initialGroupId = g.id;
        const letter = letters.find(
          (l) => l.letter_group_id === g.id && l.variant === parts.variant
        );
        if (letter) {
          initialLetterId = letter.id;
          initialView = "actions";
        }
      }
    }
  } else if (letterParam && letterParam !== "none") {
    const parts = splitSlug(letterParam);
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
      initialView={initialView}
      currentUserId={currentUserId}
      currentEmail={currentEmail}
      currentProfile={presenceProfile}
    />
  );
}
