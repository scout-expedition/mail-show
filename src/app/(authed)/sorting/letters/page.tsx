import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day, SortingLetterView } from "@/lib/db/types";
import { createSortingLetter } from "./actions";
import { SortingLettersEditor } from "./sorting-letters-editor";

export default async function SortingLettersPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: daysData }, { data: lettersData }] = await Promise.all([
    supabase.from("days").select("*").order("number"),
    supabase
      .from("sorting_letters_view")
      .select("*")
      .order("day_number")
      .order("sort_id"),
  ]);

  const days = (daysData ?? []) as Day[];
  const letters = (lettersData ?? []) as SortingLetterView[];

  return (
    <div>
      <PageHeader
        title="Sorting Letters"
        description="Letters the player must sort during the sorting phase of each day."
      />

      <SortingLettersEditor letters={letters} days={days} />

      <div className="mt-4 flex justify-center">
        <form action={createSortingLetter}>
          <Button type="submit" variant="outline" size="sm">
            + Sorting letter
          </Button>
        </form>
      </div>
    </div>
  );
}
