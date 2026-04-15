import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ActionRow,
  InspectionLetterView,
  LetterGroup,
  Storyline,
} from "@/lib/db/types";
import { GraphView } from "./graph-view";

export default async function GraphPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: sData }, { data: gData }, { data: lData }, { data: aData }] =
    await Promise.all([
      supabase.from("storylines").select("*").order("sort_order"),
      supabase.from("letter_groups").select("*").order("sequence"),
      supabase.from("inspection_letters_view").select("*"),
      supabase.from("actions").select("*").order("sort_order"),
    ]);
  const storylines = (sData ?? []) as Storyline[];
  const letterGroups = (gData ?? []) as LetterGroup[];
  const letters = (lData ?? []) as InspectionLetterView[];
  const actions = (aData ?? []) as ActionRow[];

  return (
    <div>
      <PageHeader
        title="Narrative graph"
        description="Columns = storylines; rows = letter groups by sequence. Each edge is one player action leading to the next group (colored by action)."
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
        />
      )}
    </div>
  );
}
