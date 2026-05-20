import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionTemplate, ActionTemplateGroup } from "@/lib/db/types";
import { ActionTemplatesEditor } from "./editor";

export default async function InspectionActionsPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: tData }, { data: gData }] = await Promise.all([
    supabase
      .from("action_templates")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("action_template_groups")
      .select("*")
      .order("sort_order", { ascending: true }),
  ]);
  const templates = (tData ?? []) as ActionTemplate[];
  const groups = (gData ?? []) as ActionTemplateGroup[];

  return (
    <div>
      <PageHeader
        title="Inspection Actions"
        description="Templates available when adding actions to inspection letters. Each action lives in a group — drag to reorder, drag onto another group's header to combine."
      />

      <ActionTemplatesEditor templates={templates} groups={groups} />
    </div>
  );
}
