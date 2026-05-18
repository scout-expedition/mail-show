// Server-side data fetch for the Logic page. Pulls all six ending
// documents (the framework picker needs the framework names; the five
// singleton logic docs are what each sub-tab edits) plus blocks/rows/
// chips/header-vars filtered to the five logic doc ids. Variables +
// values + nations are needed for chip-picker rendering inside the
// shared editor.

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
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
import { LogicEditor } from "./logic-editor";

export default async function EndingLogicPage() {
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
    supabase
      .from("nations")
      .select("name, color_hex, abbreviation, icon_type, icon_value"),
  ]);

  const allDocs = (documentData ?? []) as EndingDocument[];
  const logicDocs = allDocs.filter((d) => d.kind !== "framework");
  const frameworkDocs = allDocs.filter((d) => d.kind === "framework");
  const logicDocIds = new Set(logicDocs.map((d) => d.id));
  const logicBlocks = ((blockData ?? []) as EndingBlock[]).filter((b) =>
    logicDocIds.has(b.document_id)
  );
  const logicBlockIds = new Set(logicBlocks.map((b) => b.id));
  const logicRows = ((rowData ?? []) as EndingConditionRow[]).filter((r) =>
    logicBlockIds.has(r.condition_block_id)
  );
  const logicRowIds = new Set(logicRows.map((r) => r.id));
  const logicChips = ((chipData ?? []) as EndingConditionRowChip[]).filter(
    (c) => logicRowIds.has(c.row_id)
  );
  const logicHeaderVars = (
    (blockVarData ?? []) as EndingConditionBlockVariable[]
  ).filter((bv) => logicBlockIds.has(bv.condition_block_id));

  return (
    <div>
      <PageHeader
        title="Ending Logic"
        description="Pick which framework plays at ending time, and how class- and nation-affinity ties resolve."
      />
      <LogicEditor
      logicDocs={logicDocs}
      frameworkDocs={frameworkDocs}
      blocks={logicBlocks}
      rows={logicRows}
      chips={logicChips}
      blockVariables={logicHeaderVars}
      variables={(varData ?? []) as EndingVariable[]}
      values={(valueData ?? []) as EndingVariableValue[]}
      nations={
        (nationData ?? []) as Pick<
          Nation,
          "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
        >[]
      }
      currentUserId={currentUserId}
      currentEmail={currentEmail}
      currentProfile={presenceProfile}
    />
    </div>
  );
}
