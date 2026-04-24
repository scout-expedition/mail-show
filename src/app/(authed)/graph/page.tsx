import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ActionRow,
  Day,
  InspectionLetterView,
  LetterGroup,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { GraphView } from "./graph-view";

export default async function GraphPage() {
  const supabase = await createSupabaseServerClient();
  const [
    { data: sData },
    { data: gData },
    { data: lData },
    { data: aData },
    { data: dData },
    { data: rData },
  ] = await Promise.all([
    supabase.from("storylines").select("*").order("sort_order"),
    supabase.from("letter_groups").select("*").order("sequence"),
    supabase.from("inspection_letters_view").select("*"),
    supabase.from("actions").select("*").order("sort_order"),
    supabase.from("days").select("*").order("number"),
    supabase.from("report_segments_view").select("*"),
  ]);
  const storylines = (sData ?? []) as Storyline[];
  const letterGroups = (gData ?? []) as LetterGroup[];
  const letters = (lData ?? []) as InspectionLetterView[];
  const actions = (aData ?? []) as ActionRow[];
  const days = (dData ?? []) as Day[];
  const segments = (rData ?? []) as ReportSegmentView[];

  return (
    <div>
      <PageHeader
        title="Narrative graph"
        description="Columns are days; rows are storylines. Letter groups sit in their delivery day; actions arrow to report segments and the next letter."
      />
      {letterGroups.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Create some storylines and letter groups to see the graph.
        </p>
      ) : (
        <GraphView
          storylines={storylines}
          letterGroups={letterGroups}
          letters={letters}
          actions={actions}
          days={days}
          segments={segments}
        />
      )}
    </div>
  );
}
