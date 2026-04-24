import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  InspectionActionEndingAssignment,
  InspectionLetterView,
  LetterGroup,
  Nation,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { GraphSurface } from "./graph-surface";

export default async function GraphPage() {
  const supabase = await createSupabaseServerClient();
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
  ] = await Promise.all([
    supabase.from("storylines").select("*").order("sort_order"),
    supabase.from("letter_groups").select("*").order("sequence"),
    supabase.from("inspection_letters_view").select("*"),
    supabase.from("actions").select("*").order("sort_order"),
    supabase.from("days").select("*").order("number"),
    supabase.from("report_segments_view").select("*"),
    supabase.from("action_templates").select("*"),
    supabase.from("nations").select("*").order("sort_order"),
    supabase.from("inspection_action_ending_assignments").select("*"),
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
    />
  );
}
