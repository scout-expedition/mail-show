import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionTemplate } from "@/lib/db/types";
import { createActionTemplate } from "./actions";
import { ActionTemplatesEditor } from "./editor";

export default async function InspectionActionsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("action_templates")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const templates = (data ?? []) as ActionTemplate[];

  return (
    <div>
      <PageHeader
        title="Inspection Actions"
        description="Templates available when adding actions to inspection letters."
      />

      <ActionTemplatesEditor templates={templates} />

      <div className="mt-4 flex justify-center">
        <form action={createActionTemplate}>
          <Button type="submit" variant="outline" size="sm">
            + Action
          </Button>
        </form>
      </div>
    </div>
  );
}
