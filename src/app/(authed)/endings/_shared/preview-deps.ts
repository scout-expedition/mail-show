import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  EndingBlock,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingConditionBlockVariable,
  EndingDocument,
} from "@/lib/db/types";
import type { EndingLogicKind } from "@/lib/db/enums";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface EndingPreviewDeps {
  smartVariableDocs: EndingDocument[];
  smartVariableBlocks: EndingBlock[];
  smartVariableRows: EndingConditionRow[];
  smartVariableChips: EndingConditionRowChip[];
  smartVariableBlockVariables: EndingConditionBlockVariable[];
  logicDocRawByKind: Map<
    EndingLogicKind,
    {
      blocks: EndingBlock[];
      rows: EndingConditionRow[];
      chips: EndingConditionRowChip[];
    }
  > | null;
}

export async function loadEndingPreviewDeps(
  supabase: SupabaseClient,
  opts: {
    referencedSmartVariableDocIds?: string[];
    includeTiebreakLogicDocs?: boolean;
  }
): Promise<EndingPreviewDeps> {
  const { referencedSmartVariableDocIds, includeTiebreakLogicDocs = false } =
    opts;

  const filterToIds =
    referencedSmartVariableDocIds != null &&
    referencedSmartVariableDocIds.length > 0;

  const [
    { data: svDocData },
    { data: blockData },
    { data: rowData },
    { data: chipData },
    { data: blockVarData },
    logicDocsResult,
  ] = await Promise.all([
    filterToIds
      ? supabase
          .from("ending_documents")
          .select("*")
          .eq("kind", "smart_variable")
          .in("id", referencedSmartVariableDocIds!)
          .order("sort_order")
      : supabase
          .from("ending_documents")
          .select("*")
          .eq("kind", "smart_variable")
          .order("sort_order"),
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
    includeTiebreakLogicDocs
      ? supabase
          .from("ending_documents")
          .select("*")
          .not("kind", "eq", "framework")
          .not("kind", "eq", "smart_variable")
          .order("sort_order")
      : Promise.resolve({ data: null }),
  ]);

  const smartVariableDocs = (svDocData ?? []) as EndingDocument[];
  const smartDocIds = new Set(smartVariableDocs.map((d) => d.id));

  const allBlocks = (blockData ?? []) as EndingBlock[];
  const allRows = (rowData ?? []) as EndingConditionRow[];
  const allChips = (chipData ?? []) as EndingConditionRowChip[];
  const allBlockVars = (blockVarData ??
    []) as EndingConditionBlockVariable[];

  const smartVariableBlocks = allBlocks.filter(
    (b) =>
      smartDocIds.has(b.document_id) &&
      (b.block_type === "result" || b.block_type === "fallback")
  );

  const svBlockIds = new Set(
    allBlocks
      .filter((b) => smartDocIds.has(b.document_id))
      .map((b) => b.id)
  );

  const smartVariableRows = allRows.filter((r) =>
    svBlockIds.has(r.condition_block_id)
  );
  const svRowIds = new Set(smartVariableRows.map((r) => r.id));

  const smartVariableChips = allChips.filter((c) => svRowIds.has(c.row_id));

  const smartVariableBlockVariables = allBlockVars.filter((bv) =>
    svBlockIds.has(bv.condition_block_id)
  );

  let logicDocRawByKind: EndingPreviewDeps["logicDocRawByKind"] = null;

  if (includeTiebreakLogicDocs && logicDocsResult.data != null) {
    const logicDocs = logicDocsResult.data as EndingDocument[];
    logicDocRawByKind = new Map<
      EndingLogicKind,
      { blocks: EndingBlock[]; rows: EndingConditionRow[]; chips: EndingConditionRowChip[] }
    >();
    for (const d of logicDocs) {
      const docBlocks = allBlocks.filter((b) => b.document_id === d.id);
      const blockIds = new Set(docBlocks.map((b) => b.id));
      const docRows = allRows.filter((r) => blockIds.has(r.condition_block_id));
      const rowIds = new Set(docRows.map((r) => r.id));
      const docChips = allChips.filter((c) => rowIds.has(c.row_id));
      logicDocRawByKind.set(d.kind as EndingLogicKind, {
        blocks: docBlocks,
        rows: docRows,
        chips: docChips,
      });
    }
  }

  return {
    smartVariableDocs,
    smartVariableBlocks,
    smartVariableRows,
    smartVariableChips,
    smartVariableBlockVariables,
    logicDocRawByKind,
  };
}
