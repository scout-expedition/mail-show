import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Storyline } from "@/lib/db/types";
import { StorylinesEditor } from "./storylines-editor";
import { AddStorylineDialog } from "./add-storyline-dialog";

export default async function StorylinesPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("storylines")
    .select("*")
    .order("sort_order")
    .order("name");
  const storylines = (data ?? []) as Storyline[];

  return (
    <div>
      <PageHeader
        title="Storylines"
        description="Each storyline contains letter groups; each letter group contains inspection letters with player actions."
      />

      <StorylinesEditor storylines={storylines} />

      <div className="mt-4 flex justify-center">
        <AddStorylineDialog storylines={storylines} />
      </div>
    </div>
  );
}
