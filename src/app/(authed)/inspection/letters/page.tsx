import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Day,
  InspectionLetterView,
  LetterGroup,
  Storyline,
} from "@/lib/db/types";
import { InspectionLettersList } from "./list";

export default async function InspectionLettersPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: sData }, { data: gData }, { data: dData }, { data: lData }] =
    await Promise.all([
      supabase.from("storylines").select("*").order("sort_order"),
      supabase.from("letter_groups").select("*").order("sequence"),
      supabase.from("days").select("*").order("number"),
      supabase
        .from("inspection_letters_view")
        .select("*")
        .order("variant", { ascending: true, nullsFirst: true })
        .order("piece", { ascending: true, nullsFirst: true }),
    ]);
  const storylines = (sData ?? []) as Storyline[];
  const groups = (gData ?? []) as LetterGroup[];
  const days = (dData ?? []) as Day[];
  const letters = (lData ?? []) as InspectionLetterView[];

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
        letters={letters}
      />
    </div>
  );
}
