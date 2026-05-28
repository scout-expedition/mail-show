import { notFound } from "next/navigation";
import { profileFromMetadata } from "@/lib/auth/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  Playthrough,
  PlaythroughActionChoice,
  PlaythroughDeliveredLetter,
  PlaythroughVariables,
  SortingRule,
  SortingRuleCondition,
  Storyline,
} from "@/lib/db/types";
import { PlayModeShell } from "./_components/play-mode-shell";
import type { DeliveredLetterWithFallback } from "./_components/phase-inspection";

export default async function PlaythroughDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: pData }, { data: me }] = await Promise.all([
    supabase.from("playthroughs").select("*").eq("id", id).maybeSingle(),
    supabase.auth.getUser(),
  ]);
  if (!pData) notFound();
  const playthrough = pData as Playthrough;

  // Fan out the per-phase data loaders. Each phase only consumes its own
  // slice; the shell's <PhaseContent> picks based on current_phase. Loading
  // them all keeps the route a single round-trip (Promise.all) instead of
  // round-tripping per phase change.
  const [
    { data: dayData },
    { data: varsData },
    { data: refData },
    { data: rulesData },
    { data: conditionsData },
    { data: deliveredData },
    { data: actionsData },
    { data: templatesData },
    { data: storylinesData },
    { data: choicesData },
  ] = await Promise.all([
    playthrough.current_day_id
      ? supabase
          .from("days")
          .select("*")
          .eq("id", playthrough.current_day_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("playthrough_variables")
      .select("*")
      .eq("playthrough_id", id)
      .maybeSingle(),
    supabase
      .from("playthrough_reference_settings")
      .select("map_image_url")
      .limit(1)
      .maybeSingle(),
    supabase.from("sorting_rules").select("*").order("sort_order"),
    supabase.from("sorting_rule_conditions").select("*").order("position"),
    supabase
      .from("playthrough_delivered_letters_view")
      .select("*")
      .eq("playthrough_id", id)
      .order("storyline_abbreviation")
      .order("group_sequence"),
    supabase.from("actions").select("*").order("sort_order"),
    supabase.from("action_templates").select("*"),
    supabase.from("storylines").select("*").order("sort_order"),
    supabase
      .from("playthrough_action_choices")
      .select("*")
      .eq("playthrough_id", id),
  ]);

  const currentDay = (dayData as Day | null) ?? null;
  const vars = (varsData as PlaythroughVariables | null) ?? null;
  const mapImageUrl = (refData?.map_image_url as string | null) ?? null;

  // ---- Sorting phase data: filter rules active for the current day ----
  const allRules = (rulesData ?? []) as SortingRule[];
  const allConditions = (conditionsData ?? []) as SortingRuleCondition[];
  const activeRules = currentDay
    ? await filterActiveRulesForDay(supabase, allRules, currentDay)
    : [];
  const conditionsByRule: Record<string, SortingRuleCondition[]> = {};
  for (const c of allConditions) {
    (conditionsByRule[c.rule_id] ??= []).push(c);
  }

  // ---- Inspection phase data: enrich delivered letters with fallback info ----
  const delivered = (deliveredData ?? []) as PlaythroughDeliveredLetter[];
  const allActions = (actionsData ?? []) as ActionRow[];
  const templates = (templatesData ?? []) as ActionTemplate[];
  const storylines = (storylinesData ?? []) as Storyline[];
  const choices = (choicesData ?? []) as PlaythroughActionChoice[];

  const templatesById = new Map(templates.map((t) => [t.id, t]));
  const actionsByLetter: Record<string, ActionRow[]> = {};
  for (const a of allActions) {
    (actionsByLetter[a.inspection_letter_id] ??= []).push(a);
  }
  const chosenActionByLetter: Record<string, string> = {};
  for (const c of choices) {
    chosenActionByLetter[c.inspection_letter_id] = c.chosen_action_id;
  }
  const letters: DeliveredLetterWithFallback[] = delivered.map((l) => {
    const fallbackId = l.fallback_mirror_action_id;
    const fallbackAction = fallbackId
      ? allActions.find((a) => a.id === fallbackId)
      : null;
    const fallbackTpl =
      fallbackAction?.action_template_id != null
        ? (templatesById.get(fallbackAction.action_template_id) ?? null)
        : null;
    return {
      ...l,
      fallback_action_name: fallbackTpl?.name ?? null,
      fallback_action_color_hex: fallbackTpl?.color_hex ?? null,
      fallback_action_icon_type: fallbackTpl?.icon_type ?? null,
      fallback_action_icon_value: fallbackTpl?.icon_value ?? null,
    };
  });

  const user = me.user;
  const profile = user ? profileFromMetadata(user.user_metadata) : null;

  return (
    <PlayModeShell
      playthrough={playthrough}
      currentDay={currentDay}
      vars={vars}
      mapImageUrl={mapImageUrl}
      sortingPhaseData={{ rules: activeRules, conditionsByRule }}
      inspectionPhaseData={{
        letters,
        actionsByLetter,
        templates,
        storylines,
        chosenActionByLetter,
      }}
      currentUserId={user?.id}
      currentEmail={user?.email ?? undefined}
      currentProfile={
        profile
          ? {
              displayName: profile.display_name,
              avatarIconType: profile.avatar_icon_type,
              avatarIconValue: profile.avatar_icon_value,
              avatarColorHex: profile.avatar_color_hex,
            }
          : null
      }
    />
  );
}

/** A sorting rule is active on `day` when:
 *  - `day_implemented_id` is null OR its day.number ≤ current.number, AND
 *  - `day_cancelled_id` is null OR its day.number > current.number.
 *  Resolves the two referenced days in one round-trip and filters in JS. */
async function filterActiveRulesForDay(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  rules: SortingRule[],
  currentDay: Day
): Promise<SortingRule[]> {
  const refIds = new Set<string>();
  for (const r of rules) {
    if (r.day_implemented_id) refIds.add(r.day_implemented_id);
    if (r.day_cancelled_id) refIds.add(r.day_cancelled_id);
  }
  if (refIds.size === 0) {
    return rules.filter((r) => r.day_implemented_id === null);
  }
  const { data } = await supabase
    .from("days")
    .select("id, number")
    .in("id", [...refIds]);
  const dayNumberById = new Map(
    (data ?? []).map((d) => [d.id as string, d.number as number])
  );
  return rules.filter((r) => {
    const implementedNum = r.day_implemented_id
      ? dayNumberById.get(r.day_implemented_id)
      : null;
    const cancelledNum = r.day_cancelled_id
      ? dayNumberById.get(r.day_cancelled_id)
      : null;
    const implementedOk =
      implementedNum == null ? false : implementedNum <= currentDay.number;
    const notCancelled =
      cancelledNum == null || cancelledNum > currentDay.number;
    return implementedOk && notCancelled;
  });
}
