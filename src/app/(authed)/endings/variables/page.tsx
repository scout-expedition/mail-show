// Variables page: lists every text variable, grouped by which framework
// (or logic doc) references it. After migration 0022 the data sources
// changed — `ending_frameworks`/`ending_framework_blocks`/`ending_logic_*`
// tables are gone — so this file points at the unified
// `ending_documents` + `ending_blocks` schema. The reference walk now
// folds both framework and logic docs into the single graph: any chip
// whose row's block belongs to a logic-kind doc counts toward the
// "Used in ending logic" panel.

import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type {
  EndingDocument,
  EndingFramework,
  EndingVariable,
  EndingVariableFolder,
  EndingVariableValue,
} from "@/lib/db/types";
import { VariablesEditor } from "./variables-editor";

export default async function EndingVariablesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: meData } = await supabase.auth.getUser();
  const currentUserId = meData.user?.id;
  const currentEmail = meData.user?.email;
  const meProfile = profileFromMetadata(meData.user?.user_metadata);
  const presenceProfile = {
    displayName: meProfile.display_name,
    avatarIconType: meProfile.avatar_icon_type,
    avatarIconValue: meProfile.avatar_icon_value,
    avatarColorHex: meProfile.avatar_color_hex,
  };
  const [
    { data: varData },
    { data: valueData },
    { data: folderData },
    { data: documentData },
    { data: blockData },
    { data: rowData },
    { data: chipData },
  ] = await Promise.all([
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
    supabase
      .from("ending_variable_folders")
      .select("*")
      .eq("scope", "variable")
      .order("sort_order"),
    supabase.from("ending_documents").select("*").order("sort_order"),
    supabase.from("ending_blocks").select("id, document_id"),
    supabase.from("ending_condition_rows").select("id, condition_block_id"),
    supabase.from("ending_condition_row_chips").select("variable_id, row_id"),
  ]);

  const allDocs = (documentData ?? []) as EndingDocument[];
  const frameworkDocs = allDocs.filter((d) => d.kind === "framework");
  const docKindById = new Map<string, EndingDocument["kind"]>();
  for (const d of allDocs) docKindById.set(d.id, d.kind);

  // Walk chip → row → block → document. Frameworks land in
  // `frameworkVariableRefs`; logic-kind docs land in `logicVariableIds`.
  const blockToDoc = new Map<string, string>();
  for (const b of (blockData ?? []) as Array<{
    id: string;
    document_id: string;
  }>) {
    blockToDoc.set(b.id, b.document_id);
  }
  const rowToDoc = new Map<string, string>();
  for (const r of (rowData ?? []) as Array<{
    id: string;
    condition_block_id: string;
  }>) {
    const docId = blockToDoc.get(r.condition_block_id);
    if (docId) rowToDoc.set(r.id, docId);
  }
  const frameworkVariableRefs: Array<{
    framework_id: string;
    variable_id: string;
  }> = [];
  const seenFrameworkPair = new Set<string>();
  const logicVariableIds = new Set<string>();
  for (const c of (chipData ?? []) as Array<{
    variable_id: string;
    row_id: string;
  }>) {
    const docId = rowToDoc.get(c.row_id);
    if (!docId) continue;
    const kind = docKindById.get(docId);
    if (kind === "framework") {
      const key = `${docId}:${c.variable_id}`;
      if (seenFrameworkPair.has(key)) continue;
      seenFrameworkPair.add(key);
      frameworkVariableRefs.push({
        framework_id: docId,
        variable_id: c.variable_id,
      });
    } else if (kind) {
      logicVariableIds.add(c.variable_id);
    }
  }

  // The editor still expects the `EndingFramework` shape (id + name +
  // sort_order). Frameworks always have a non-null name per CHECK
  // constraint, but TS sees the column as nullable on EndingDocument —
  // narrow at the boundary.
  const frameworkRows: EndingFramework[] = frameworkDocs.map((d) => ({
    id: d.id,
    name: d.name ?? "(unnamed)",
    sort_order: d.sort_order,
  }));

  const logicConditions = Array.from(logicVariableIds, (variable_id) => ({
    variable_id,
  }));

  return (
    <div>
      <PageHeader
        title="Ending Variables"
        description="Variables and values referenced by frameworks and logic chips."
      />
      <VariablesEditor
        variables={(varData ?? []) as EndingVariable[]}
        values={(valueData ?? []) as EndingVariableValue[]}
        folders={(folderData ?? []) as EndingVariableFolder[]}
        frameworks={frameworkRows}
        frameworkVariableRefs={frameworkVariableRefs}
        logicConditions={logicConditions}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />
    </div>
  );
}
