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
import { FrameworksWorkspace } from "./workspace";
import type { EndingLogicKind } from "@/lib/db/enums";
import { slugify } from "@/lib/slug";

export default async function FrameworksPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}) {
  const { name: slug } = await searchParams;
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
    { data: allDocData },
    { data: blockData },
    { data: rowData },
    { data: chipData },
    { data: blockVarData },
    { data: varData },
    { data: valueData },
    { data: folderData },
    { data: nationData },
  ] = await Promise.all([
    // Fetch all documents in one shot — frameworks, logic singletons,
    // and smart_variable docs are all needed downstream (the framework
    // list filters to kind='framework'; the tiebreak summary needs the
    // logic docs; smart variables feed the per-variable returns map for
    // chip pickers).
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

  // Filter blocks to those whose document_id is one of our framework
  // docs — saves a JOIN at the cost of a tiny client-side filter.
  const allDocs = (allDocData ?? []) as EndingDocument[];
  const frameworkDocs = allDocs.filter((d) => d.kind === "framework");

  // Resolve ?name=<slug> → selectedId. Fall back to first by sort_order
  // when the slug matches nothing (stale link, renamed framework, etc.).
  const selectedId = slug
    ? (frameworkDocs.find((f) => slugify(f.name ?? "") === slug)?.id ??
        frameworkDocs[0]?.id ??
        null)
    : null;
  const frameworkIds = new Set(frameworkDocs.map((d) => d.id));
  const frameworkBlocks = ((blockData ?? []) as EndingBlock[]).filter((b) =>
    frameworkIds.has(b.document_id)
  );
  // Logic docs (used by the per-kind tiebreak summary below).
  const logicDocData = allDocs.filter(
    (d) => d.kind !== "framework" && d.kind !== "smart_variable"
  );

  // Smart Variables live in their own kind='smart_variable' docs.
  // We pass the raw docs + their result/fallback blocks through so the
  // workspace can derive `smartVariableReturns` client-side AND keep
  // it live as result_value edits stream in via postgres_changes —
  // without that, chip dropdowns would show the snapshot at first
  // render and never reflect downstream edits without a refresh.
  const smartVariableDocs = allDocs.filter((d) => d.kind === "smart_variable");
  const smartDocIds = new Set(smartVariableDocs.map((d) => d.id));
  const smartVariableBlocks = ((blockData ?? []) as EndingBlock[]).filter(
    (b) =>
      smartDocIds.has(b.document_id) &&
      (b.block_type === "result" || b.block_type === "fallback")
  );

  // Per-logic-kind tiebreak summary for static analysis. A doc is
  // "empty" only when both: it has zero condition-block rows AND its
  // fallback (if any) carries no result_value. A non-empty doc lets
  // the aggregate-chip outcome enumeration drop the tie state.
  const allBlocks = (blockData ?? []) as EndingBlock[];
  const allRows = (rowData ?? []) as EndingConditionRow[];
  const tiebreakDocsSummary = new Map<EndingLogicKind, { isEmpty: boolean }>();
  for (const d of logicDocData) {
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
  for (const d of logicDocData) {
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
    <div>
      <PageHeader
        title="Ending Frameworks"
        description="Madlib-style story templates. Each framework's blocks render based on the variables and chips that match at ending time."
      />
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
      folders={(folderData ?? []) as EndingVariableFolder[]}
      nations={
        (nationData ?? []) as Pick<
          Nation,
          "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
        >[]
      }
      selectedFrameworkId={selectedId ?? null}
      smartVariableDocs={smartVariableDocs}
      smartVariableBlocks={smartVariableBlocks}
      tiebreakDocsSummary={tiebreakDocsSummary}
      tiebreakDocsRaw={logicDocRawByKind}
      currentUserId={currentUserId}
      currentEmail={currentEmail}
      currentProfile={presenceProfile}
    />
    </div>
  );
}
