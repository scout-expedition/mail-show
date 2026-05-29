import type { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  evaluateDocument,
  resolveAggregates,
  EMPTY_SELECTIONS,
  type EvalInputs,
  type EvalBlock,
  type EvalRow,
  type EvalChip,
  type EvalVariable,
  type PreviewSelections,
} from "@/lib/endings/evaluator";
import { ENDING_LOGIC_KINDS, type EndingLogicKind } from "@/lib/db/enums";
import type { AggregateRef } from "@/lib/db/enums";
import type {
  EndingVariable,
  EndingVariableValue,
  PlaythroughVariables,
} from "@/lib/db/types";

export interface EndingResult {
  frameworkDocId: string | null;
  frameworkName: string | null;
  paragraphs: string[];
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const IMPACT_COLUMNS: readonly (keyof Omit<PlaythroughVariables, "playthrough_id">)[] = [
  "world_status",
  "demerits",
  "proletariat",
  "gentry",
  "epicenter",
  "folos",
  "emberlyn",
  "spokgrad",
  "pelico",
  "combined_national",
];

async function loadDocBlocks(supabase: Supabase, docId: string) {
  const { data: blocks } = await supabase
    .from("ending_blocks")
    .select("*")
    .eq("document_id", docId)
    .order("sort_order");

  const blockIds = (blocks ?? []).map((b) => b.id as string);
  if (blockIds.length === 0) {
    return { blocks: [], rows: [], chips: [] };
  }

  const { data: rows } = await supabase
    .from("ending_condition_rows")
    .select("*")
    .in("condition_block_id", blockIds)
    .order("sort_order");

  const rowIds = (rows ?? []).map((r) => r.id as string);
  const { data: chips } =
    rowIds.length > 0
      ? await supabase
          .from("ending_condition_row_chips")
          .select("*")
          .in("row_id", rowIds)
          .order("sort_order")
      : { data: [] };

  return {
    blocks: (blocks ?? []) as unknown as EvalBlock[],
    rows: (rows ?? []) as unknown as EvalRow[],
    chips: (chips ?? []) as unknown as EvalChip[],
  };
}

function buildEvalInputs(
  docData: { blocks: EvalBlock[]; rows: EvalRow[]; chips: EvalChip[] },
  evalVariables: EvalVariable[],
  selections: PreviewSelections,
  values?: EndingVariableValue[]
): EvalInputs {
  return {
    blocks: docData.blocks,
    rows: docData.rows,
    chips: docData.chips,
    variables: evalVariables,
    selections,
    values,
  };
}

export async function evaluatePlaythroughEnding(
  supabase: Supabase,
  vars: PlaythroughVariables
): Promise<EndingResult> {
  const [{ data: allVarsData }, { data: allValuesData }] = await Promise.all([
    supabase.from("ending_variables").select("*"),
    supabase.from("ending_variable_values").select("*"),
  ]);
  const allVars = (allVarsData ?? []) as EndingVariable[];
  const allValues = (allValuesData ?? []) as EndingVariableValue[];

  // Build numberRefByName + numbers from playthrough variables.
  const numberRefByName = new Map<string, string>();
  const numbers: Record<string, number> = {};
  for (const v of allVars) {
    if (v.kind === "number_ref" && v.number_ref) {
      numberRefByName.set(v.number_ref, v.id);
      const col = v.number_ref as (typeof IMPACT_COLUMNS)[number];
      numbers[v.id] = IMPACT_COLUMNS.includes(col) ? vars[col] : 0;
    }
  }

  const evalVariables: EvalVariable[] = allVars.map((v) => ({
    id: v.id,
    name: v.name,
    kind: v.kind,
    aggregate_ref: (v.aggregate_ref as AggregateRef) ?? null,
  }));
  const variableIndex = new Map(evalVariables.map((v) => [v.id, v]));

  // Load all logic docs (framework_selection + tiebreak docs).
  const { data: logicDocs } = await supabase
    .from("ending_documents")
    .select("id, kind, name")
    .in("kind", [...ENDING_LOGIC_KINDS]);

  const logicDocByKind = new Map<EndingLogicKind, { id: string; name: string | null }>();
  for (const d of logicDocs ?? []) {
    logicDocByKind.set(d.kind as EndingLogicKind, { id: d.id, name: d.name });
  }

  // Load block trees for all logic docs in parallel.
  const loadPromises = new Map<EndingLogicKind, Promise<{ blocks: EvalBlock[]; rows: EvalRow[]; chips: EvalChip[] }>>();
  for (const [kind, doc] of logicDocByKind) {
    loadPromises.set(kind, loadDocBlocks(supabase, doc.id));
  }
  const loaded = new Map<EndingLogicKind, { blocks: EvalBlock[]; rows: EvalRow[]; chips: EvalChip[] }>();
  for (const [kind, p] of loadPromises) {
    loaded.set(kind, await p);
  }

  // Build tiebreak docs (all logic kinds except framework_selection).
  const baseSelections: PreviewSelections = {
    ...EMPTY_SELECTIONS,
    numbers,
    numberRefByName,
  };
  const tiebreakDocs = new Map<EndingLogicKind, EvalInputs>();
  for (const kind of ENDING_LOGIC_KINDS) {
    const data = loaded.get(kind);
    if (!data) continue;
    tiebreakDocs.set(
      kind,
      buildEvalInputs(data, evalVariables, { ...baseSelections })
    );
  }

  // --- Pass 1: evaluate framework_selection to find the framework ---
  const selectionData = loaded.get("framework_selection");
  if (!selectionData) {
    return { frameworkDocId: null, frameworkName: null, paragraphs: [] };
  }

  const selectionSelections: PreviewSelections = {
    ...baseSelections,
    tiebreak_docs: tiebreakDocs,
  };
  const selectionResolved = resolveAggregates(
    selectionData.chips,
    variableIndex,
    selectionSelections
  );
  selectionSelections.resolved_aggregates = selectionResolved;

  const selectionInputs = buildEvalInputs(
    selectionData,
    evalVariables,
    selectionSelections
  );
  const selectionResult = evaluateDocument(selectionInputs);

  if (selectionResult.length === 0) {
    return { frameworkDocId: null, frameworkName: null, paragraphs: [] };
  }

  const frameworkDocId = selectionResult[0];

  // Fetch the framework doc's name.
  const { data: frameworkDoc } = await supabase
    .from("ending_documents")
    .select("id, name")
    .eq("id", frameworkDocId)
    .maybeSingle();

  if (!frameworkDoc) {
    return { frameworkDocId, frameworkName: null, paragraphs: [] };
  }

  // --- Pass 2: evaluate the chosen framework to get paragraph text ---
  const frameworkData = await loadDocBlocks(supabase, frameworkDocId);
  const frameworkSelections: PreviewSelections = {
    ...baseSelections,
    tiebreak_docs: tiebreakDocs,
  };
  const frameworkResolved = resolveAggregates(
    frameworkData.chips,
    variableIndex,
    frameworkSelections
  );
  frameworkSelections.resolved_aggregates = frameworkResolved;

  const frameworkInputs = buildEvalInputs(
    frameworkData,
    evalVariables,
    frameworkSelections,
    allValues
  );
  const paragraphs = evaluateDocument(frameworkInputs);

  return {
    frameworkDocId,
    frameworkName: frameworkDoc.name,
    paragraphs,
  };
}
