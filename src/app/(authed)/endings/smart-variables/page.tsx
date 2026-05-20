// Server-side data fetch for the Smart Variables page.
//
// Smart Variables are user-created `ending_documents` of kind='smart_variable'
// paired 1:1 with an `ending_variables` row of kind='smart_ref'. Each pair
// owns a condition-block tree whose result blocks are free-text strings.
// Loading all of them up-front (plus every other variable + value + nation)
// keeps the editor's chip pickers consistent with the rest of the endings
// pages.

import { PageHeader } from "@/components/page-header";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profileFromMetadata } from "@/lib/auth/profile";
import type {
  EndingBlock,
  EndingConditionBlockVariable,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingDocument,
  EndingVariable,
  EndingVariableFolder,
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
import { SmartVariablesEditor } from "./smart-variables-editor";

export default async function SmartVariablesPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const { doc: selectedDocId } = await searchParams;
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
    { data: documentData },
    { data: blockData },
    { data: rowData },
    { data: chipData },
    { data: blockVarData },
    { data: varData },
    { data: valueData },
    { data: folderData },
    { data: nationData },
  ] = await Promise.all([
    supabase.from("ending_documents").select("*").order("sort_order"),
    supabase.from("ending_blocks").select("*").order("sort_order"),
    supabase.from("ending_condition_rows").select("*").order("sort_order"),
    supabase
      .from("ending_condition_row_chips")
      .select("*")
      .order("sort_order"),
    supabase
      .from("ending_condition_block_variables")
      .select("*")
      .order("sort_order"),
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
    supabase.from("ending_variable_folders").select("*").order("sort_order"),
    supabase
      .from("nations")
      .select("name, color_hex, abbreviation, icon_type, icon_value"),
  ]);

  const allDocs = (documentData ?? []) as EndingDocument[];
  const smartDocs = allDocs.filter((d) => d.kind === "smart_variable");
  const smartDocIds = new Set(smartDocs.map((d) => d.id));
  const smartBlocks = ((blockData ?? []) as EndingBlock[]).filter((b) =>
    smartDocIds.has(b.document_id)
  );
  const smartBlockIds = new Set(smartBlocks.map((b) => b.id));
  const smartRows = ((rowData ?? []) as EndingConditionRow[]).filter((r) =>
    smartBlockIds.has(r.condition_block_id)
  );
  const smartRowIds = new Set(smartRows.map((r) => r.id));
  const smartChips = ((chipData ?? []) as EndingConditionRowChip[]).filter(
    (c) => smartRowIds.has(c.row_id)
  );
  const smartHeaderVars = (
    (blockVarData ?? []) as EndingConditionBlockVariable[]
  ).filter((bv) => smartBlockIds.has(bv.condition_block_id));

  return (
    <div>
      <PageHeader
        title="Smart Variables"
        description="User-created variables that resolve to a free-text string via a condition-block tree. Reference them in ending logic + frameworks just like text variables."
      />
      <SmartVariablesEditor
        smartDocs={smartDocs}
        blocks={smartBlocks}
        rows={smartRows}
        chips={smartChips}
        blockVariables={smartHeaderVars}
        variables={(varData ?? []) as EndingVariable[]}
        values={(valueData ?? []) as EndingVariableValue[]}
        folders={(folderData ?? []) as EndingVariableFolder[]}
        nations={
          (nationData ?? []) as Pick<
            Nation,
            "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
          >[]
        }
        selectedDocId={selectedDocId ?? null}
        currentUserId={currentUserId}
        currentEmail={currentEmail}
        currentProfile={presenceProfile}
      />
    </div>
  );
}
