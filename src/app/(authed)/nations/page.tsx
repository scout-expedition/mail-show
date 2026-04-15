import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Nation } from "@/lib/db/types";
import { createNation } from "./actions";
import { NationsEditor } from "./nations-editor";

export default async function NationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("nations")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const nations = (data ?? []) as Nation[];

  return (
    <div>
      <PageHeader
        title="Nations"
        description="The five nations of the game. Each has a display color and icon used across the app."
      />

      <NationsEditor nations={nations} />

      <div className="mt-4 flex justify-center">
        <form action={createNation}>
          <Button type="submit" variant="outline" size="sm">
            + Nation
          </Button>
        </form>
      </div>
    </div>
  );
}
