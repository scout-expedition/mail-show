import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day, LetterGroup, Storyline } from "@/lib/db/types";
import { InspectionLettersList } from "./list";

export default async function InspectionLettersPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: sData }, { data: gData }, { data: dData }] = await Promise.all([
    supabase.from("storylines").select("*").order("sort_order"),
    supabase.from("letter_groups").select("*").order("sequence"),
    supabase.from("days").select("*").order("number"),
  ]);
  const storylines = (sData ?? []) as Storyline[];
  const groups = (gData ?? []) as LetterGroup[];
  const days = (dData ?? []) as Day[];

  return (
    <div>
      <PageHeader
        title="Inspection Letters"
        description="All letter groups across every storyline."
      />
      <InspectionLettersList
        storylines={storylines}
        groups={groups}
        days={days}
      />
    </div>
  );
}
