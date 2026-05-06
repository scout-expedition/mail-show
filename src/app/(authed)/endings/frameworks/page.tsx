import { createSupabaseServerClient } from "@/lib/supabase/server";
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
import { FrameworksWorkspace } from "./workspace";
import type { EndingLogicKind } from "@/lib/db/enums";

export default async function FrameworksPage({
  searchParams,
}: {
  searchParams: Promise<{ framework?: string }>;
}) {
  const { framework: selectedId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [
    { data: documentData },
    { data: logicDocData },
    { data: blockData },
    { data: rowData },
    { data: chipData },
    { data: blockVarData },
    { data: varData },
    { data: valueData },
    { data: nationData },
  ] = await Promise.all([
    supabase
      .from("ending_documents")
      .select("*")
      .eq("kind", "framework")
      .order("sort_order"),
    // Logic-kind documents — used downstream to compute the per-kind
    // tiebreak summary that the static analyzer reads.
    supabase
      .from("ending_documents")
      .select("id, kind")
      .neq("kind", "framework"),
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
    supabase.from("nations").select("name, color_hex"),
  ]);

  // Filter blocks to those whose document_id is one of our framework
  // docs — saves a JOIN at the cost of a tiny client-side filter.
  const frameworkDocs = (documentData ?? []) as EndingDocument[];
  const frameworkIds = new Set(frameworkDocs.map((d) => d.id));
  const frameworkBlocks = ((blockData ?? []) as EndingBlock[]).filter((b) =>
    frameworkIds.has(b.document_id)
  );

  // Per-logic-kind tiebreak summary for static analysis. A doc is
  // "empty" only when both: it has zero condition-block rows AND its
  // fallback (if any) carries no result_value. A non-empty doc lets
  // the aggregate-chip outcome enumeration drop the tie state.
  const allBlocks = (blockData ?? []) as EndingBlock[];
  const allRows = (rowData ?? []) as EndingConditionRow[];
  const tiebreakDocsSummary = new Map<EndingLogicKind, { isEmpty: boolean }>();
  for (const d of (logicDocData ?? []) as Pick<EndingDocument, "id" | "kind">[]) {
    const docBlocks = allBlocks.filter((b) => b.document_id === d.id);
    const conditionBlockIds = new Set(
      docBlocks.filter((b) => b.block_type === "condition").map((b) => b.id)
    );
    const hasRow = allRows.some((r) =>
      conditionBlockIds.has(r.condition_block_id)
    );
    const fallback = docBlocks.find((b) => b.block_type === "fallback");
    const fallbackSet =
      fallback?.result_value != null && fallback.result_value !== "";
    tiebreakDocsSummary.set(d.kind as EndingLogicKind, {
      isEmpty: !hasRow && !fallbackSet,
    });
  }

  // Per-logic-kind raw block/row/chip data for the framework preview's
  // tiebreak resolution. The preview builds EvalInputs for each kind
  // out of these so aggregate chips can run their tiebreak doc when
  // the user's numeric inputs produce a tie.
  const allChips = (chipData ?? []) as EndingConditionRowChip[];
  const logicDocRawByKind = new Map<
    EndingLogicKind,
    {
      blocks: EndingBlock[];
      rows: EndingConditionRow[];
      chips: EndingConditionRowChip[];
    }
  >();
  for (const d of (logicDocData ?? []) as Pick<EndingDocument, "id" | "kind">[]) {
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

  return (
    <FrameworksWorkspace
      frameworks={frameworkDocs}
      blocks={frameworkBlocks}
      rows={(rowData ?? []) as EndingConditionRow[]}
      chips={(chipData ?? []) as EndingConditionRowChip[]}
      blockVariables={
        (blockVarData ?? []) as EndingConditionBlockVariable[]
      }
      variables={(varData ?? []) as EndingVariable[]}
      values={(valueData ?? []) as EndingVariableValue[]}
      nations={(nationData ?? []) as Pick<Nation, "name" | "color_hex">[]}
      selectedFrameworkId={selectedId ?? null}
      tiebreakDocsSummary={tiebreakDocsSummary}
      tiebreakDocsRaw={logicDocRawByKind}
    />
  );
}
