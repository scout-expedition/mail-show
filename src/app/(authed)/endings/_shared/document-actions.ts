"use server";

// Unified server actions for ending documents (frameworks + the five
// logic-tab tiebreak / framework-selection docs). Both surfaces call
// into this module — the frameworks workspace (step 2 of
// docs/endings-logic-v2-plan.md) wires up first; the Logic tab
// (step 3) hooks the same actions onto the shared editor.
//
// Shape mirrors the pre-rebuild `frameworks/actions.ts` — same UPDATE-only
// `saveDocument`, same chip-shape — but generalises over `kind`. Result
// blocks validate their `result_value` against the doc's kind via
// ENDING_LOGIC_RESULT_OPTIONS_BY_KIND. Frameworks reject result leaves;
// logic docs reject text leaves.

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { colorIndexFor } from "@/lib/endings/color-palette";
import {
  ENDING_LOGIC_RESULT_OPTIONS_BY_KIND,
  RANDOM_RESULT_SENTINEL,
  type EndingBlockType,
  type EndingChipOperator,
  type EndingDocumentKind,
  type EndingLogicKind,
} from "@/lib/db/enums";

function revalidateEndings() {
  revalidatePath("/endings/variables");
  revalidatePath("/endings/logic");
  revalidatePath("/endings/frameworks");
  revalidatePath("/inspection/letters");
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function uniqueFrameworkName(
  supabase: Supabase,
  base: string
): Promise<string> {
  let name = base;
  for (let i = 2; ; i++) {
    const { data } = await supabase
      .from("ending_documents")
      .select("id")
      .eq("kind", "framework")
      .eq("name", name)
      .maybeSingle();
    if (!data) return name;
    name = `${base} ${i}`;
  }
}

// --- Documents ----------------------------------------------------------

/**
 * Create a `kind='framework'` document. The other five document kinds
 * are seed-immortal singletons; this entrypoint refuses to create any of
 * them so callers can't accidentally bypass that invariant.
 */
export async function createFrameworkDocument(input: {
  name?: string;
} = {}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("ending_documents")
    .select("sort_order")
    .eq("kind", "framework")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const baseName = input.name?.trim() || "New framework";
  const name = await uniqueFrameworkName(supabase, baseName);
  const { data, error } = await supabase
    .from("ending_documents")
    .insert({ kind: "framework", name, sort_order: nextSort })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data.id as string };
}

async function getDocumentKind(
  supabase: Supabase,
  id: string
): Promise<EndingDocumentKind | null> {
  const { data } = await supabase
    .from("ending_documents")
    .select("kind")
    .eq("id", id)
    .maybeSingle();
  return (data?.kind as EndingDocumentKind | undefined) ?? null;
}

/**
 * Rename a `kind='framework'` document. Logic-kind docs are anonymous
 * (their kind IS their identity) so this rejects when called against
 * one of them.
 */
export async function renameDocument(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id) return;
  if (!name) throw new Error("Document name cannot be empty.");
  const kind = await getDocumentKind(supabase, id);
  if (!kind) throw new Error(`Unknown document ${id}.`);
  if (kind !== "framework") {
    throw new Error("Only framework documents can be renamed.");
  }
  const { error } = await supabase
    .from("ending_documents")
    .update({ name })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

/**
 * Delete a `kind='framework'` document. Logic-kind docs are seeded
 * singletons and this rejects when asked to delete one of them.
 */
export async function deleteFrameworkDocument(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const kind = await getDocumentKind(supabase, id);
  if (!kind) return;
  if (kind !== "framework") {
    throw new Error("Logic documents are seed-immortal and cannot be deleted.");
  }
  const { error } = await supabase
    .from("ending_documents")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

// --- Blocks -------------------------------------------------------------

async function fetchSiblings(
  supabase: Supabase,
  documentId: string,
  parentBlockId: string | null,
  parentRowId: string | null
): Promise<Array<{ id: string; block_type: string }>> {
  let q = supabase
    .from("ending_blocks")
    .select("id, block_type")
    .eq("document_id", documentId);
  q = parentBlockId
    ? q.eq("parent_block_id", parentBlockId)
    : q.is("parent_block_id", null);
  q = parentRowId
    ? q.eq("parent_row_id", parentRowId)
    : q.is("parent_row_id", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function nextSiblingSort(
  supabase: Supabase,
  documentId: string,
  parentBlockId: string | null,
  parentRowId: string | null
): Promise<number> {
  let q = supabase
    .from("ending_blocks")
    .select("sort_order")
    .eq("document_id", documentId);
  q = parentBlockId
    ? q.eq("parent_block_id", parentBlockId)
    : q.is("parent_block_id", null);
  q = parentRowId
    ? q.eq("parent_row_id", parentRowId)
    : q.is("parent_row_id", null);
  const { data } = await q
    .order("sort_order", { ascending: false })
    .limit(1);
  return (data?.[0]?.sort_order ?? 0) + 1;
}

async function validateResultValue(
  supabase: Supabase,
  kind: EndingDocumentKind,
  result_value: string
): Promise<void> {
  if (kind === "framework") {
    throw new Error("Framework documents cannot contain result blocks.");
  }
  // RANDOM_RESULT_SENTINEL is allowed on every logic-kind doc. The
  // evaluator expands it at call sites; storage is just the literal.
  if (result_value === RANDOM_RESULT_SENTINEL) return;
  const logicKind = kind as EndingLogicKind;
  const allowed = ENDING_LOGIC_RESULT_OPTIONS_BY_KIND[logicKind];
  if (allowed) {
    if (!allowed.includes(result_value)) {
      throw new Error(
        `Invalid result_value '${result_value}' for ${logicKind}: expected one of ${allowed.join(
          ", "
        )}.`
      );
    }
    return;
  }
  // framework_selection — must reference a kind='framework' document by id.
  const { data } = await supabase
    .from("ending_documents")
    .select("id, kind")
    .eq("id", result_value)
    .maybeSingle();
  if (!data || data.kind !== "framework") {
    throw new Error(
      `Invalid framework_selection result_value '${result_value}': must be the id of a framework document.`
    );
  }
}

export interface AddBlockInput {
  document_id: string;
  parent_block_id: string | null;
  parent_row_id: string | null;
  block_type: EndingBlockType;
  /** For block_type === 'text'. */
  text?: string | null;
  /** For block_type === 'result'. */
  result_value?: string | null;
}

/**
 * Create a single block. Validates against the parent document's kind:
 *  - framework → text + condition only; result rejected.
 *  - logic     → result + condition only; text rejected. result_value
 *                must satisfy ENDING_LOGIC_RESULT_OPTIONS_BY_KIND for
 *                affinity kinds, and must be a framework document id
 *                for framework_selection.
 *
 * Condition blocks seed exactly one empty row so the authoring surface
 * has something to draw — same as the pre-rebuild `createConditionBlock`.
 */
export async function addBlock(
  input: AddBlockInput
): Promise<{ id: string; row_id?: string }> {
  const supabase = await createSupabaseServerClient();
  const kind = await getDocumentKind(supabase, input.document_id);
  if (!kind) throw new Error(`Unknown document ${input.document_id}.`);

  if (input.block_type === "text" && kind !== "framework") {
    throw new Error("Logic documents cannot contain text blocks.");
  }
  if (input.block_type === "result" && kind === "framework") {
    throw new Error("Framework documents cannot contain result blocks.");
  }
  if (input.block_type === "fallback") {
    throw new Error(
      "Fallback blocks aren't author-created — they're seeded with the document."
    );
  }

  // Result-block uniqueness within a sibling group: a result block
  // ends evaluation for its branch, so siblings would never run.
  // Reject the add when:
  //   - adding a result and the group already has anything, OR
  //   - adding a non-result and the group already has a result.
  // Fallback blocks are exempt from the rule — they coexist with
  // result/condition blocks at the document root and only fire when
  // nothing else matched.
  const siblings = (
    await fetchSiblings(
      supabase,
      input.document_id,
      input.parent_block_id,
      input.parent_row_id
    )
  ).filter((b) => b.block_type !== "fallback");
  const groupHasResult = siblings.some((b) => b.block_type === "result");
  if (input.block_type === "result" && siblings.length > 0) {
    throw new Error(
      "A result block must be the only block in its sibling group."
    );
  }
  if (input.block_type !== "result" && groupHasResult) {
    throw new Error(
      "Cannot add a block alongside an existing result block in the same sibling group."
    );
  }

  let textValue: string | null = null;
  let resultValue: string | null = null;
  if (input.block_type === "text") {
    textValue = input.text ?? "";
  } else if (input.block_type === "result") {
    if (input.result_value == null || input.result_value === "") {
      throw new Error("Result blocks require a result_value.");
    }
    await validateResultValue(supabase, kind, input.result_value);
    resultValue = input.result_value;
  }

  const nextSort = await nextSiblingSort(
    supabase,
    input.document_id,
    input.parent_block_id,
    input.parent_row_id
  );

  const { data: block, error } = await supabase
    .from("ending_blocks")
    .insert({
      document_id: input.document_id,
      parent_block_id: input.parent_block_id,
      parent_row_id: input.parent_row_id,
      block_type: input.block_type,
      text: textValue,
      result_value: resultValue,
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  let rowId: string | undefined;
  if (input.block_type === "condition") {
    const { data: row, error: rowErr } = await supabase
      .from("ending_condition_rows")
      .insert({ condition_block_id: block.id, sort_order: 0 })
      .select("id")
      .single();
    if (rowErr) throw new Error(rowErr.message);
    rowId = row.id as string;
    // Seed a default leaf under the auto-created row (matches the
    // explicit `addRow` path so authors get a workable starting point
    // regardless of how the row was created).
    await seedDefaultLeafForRow(supabase, block.id as string, rowId);
  }

  revalidateEndings();
  return rowId !== undefined
    ? { id: block.id as string, row_id: rowId }
    : { id: block.id as string };
}

export async function deleteBlock(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { data: existing, error: lookupErr } = await supabase
    .from("ending_blocks")
    .select("block_type")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) throw new Error(lookupErr.message);
  if (existing?.block_type === "fallback") {
    throw new Error("Fallback blocks can't be deleted.");
  }
  const { error } = await supabase
    .from("ending_blocks")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

// --- Rows ---------------------------------------------------------------

export async function addRow(input: {
  block_id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("ending_condition_rows")
    .select("sort_order")
    .eq("condition_block_id", input.block_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const { data, error } = await supabase
    .from("ending_condition_rows")
    .insert({
      condition_block_id: input.block_id,
      sort_order: nextSort,
    })
    .select("id, condition_block_id")
    .single();
  if (error) throw new Error(error.message);

  // Seed a default leaf block under the new row so authors don't have
  // to add one manually each time. Frameworks → blank text block;
  // logic docs → result block with the kind's default option (first
  // framework, "proletariat", "folos", etc.). Skip the seed if the
  // doc kind has no default available (e.g. framework_selection with
  // zero frameworks).
  await seedDefaultLeafForRow(supabase, input.block_id, data.id as string);

  revalidateEndings();
  return { id: data.id as string };
}

async function seedDefaultLeafForRow(
  supabase: Supabase,
  conditionBlockId: string,
  rowId: string
): Promise<void> {
  const { data: parent } = await supabase
    .from("ending_blocks")
    .select("document_id")
    .eq("id", conditionBlockId)
    .maybeSingle();
  if (!parent?.document_id) return;
  const docId = parent.document_id as string;
  const kind = await getDocumentKind(supabase, docId);
  if (!kind) return;

  if (kind === "framework") {
    await supabase.from("ending_blocks").insert({
      document_id: docId,
      parent_block_id: conditionBlockId,
      parent_row_id: rowId,
      block_type: "text",
      text: "",
      sort_order: 0,
    });
    return;
  }

  // Logic doc: pick a default result_value per kind.
  const allowed = ENDING_LOGIC_RESULT_OPTIONS_BY_KIND[kind as EndingLogicKind];
  let defaultValue: string | null = null;
  if (allowed && allowed.length > 0) {
    defaultValue = allowed[0];
  } else if (kind === "framework_selection") {
    const { data: firstFramework } = await supabase
      .from("ending_documents")
      .select("id")
      .eq("kind", "framework")
      .order("sort_order")
      .limit(1)
      .maybeSingle();
    defaultValue = (firstFramework?.id as string | undefined) ?? null;
  }
  if (defaultValue == null) return; // nothing valid to seed; leave row empty
  await supabase.from("ending_blocks").insert({
    document_id: docId,
    parent_block_id: conditionBlockId,
    parent_row_id: rowId,
    block_type: "result",
    result_value: defaultValue,
    sort_order: 0,
  });
}

export async function deleteRow(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase
    .from("ending_condition_rows")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

// --- Block-variable headers ---------------------------------------------

export async function addBlockVariable(input: {
  block_id: string;
  variable_id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("ending_condition_block_variables")
    .select("sort_order")
    .eq("condition_block_id", input.block_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? -1) + 1;
  const { data, error } = await supabase
    .from("ending_condition_block_variables")
    .upsert(
      {
        condition_block_id: input.block_id,
        variable_id: input.variable_id,
        sort_order: nextSort,
      },
      { onConflict: "condition_block_id,variable_id", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    const { data: existingRow } = await supabase
      .from("ending_condition_block_variables")
      .select("id")
      .eq("condition_block_id", input.block_id)
      .eq("variable_id", input.variable_id)
      .single();
    if (!existingRow)
      throw new Error("addBlockVariable: row missing post-upsert");
    revalidateEndings();
    return { id: existingRow.id as string };
  }
  revalidateEndings();
  return { id: data[0].id as string };
}

export async function removeBlockVariable(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { data: header } = await supabase
    .from("ending_condition_block_variables")
    .select("condition_block_id, variable_id")
    .eq("id", id)
    .single();
  if (header) {
    const { data: blockRows } = await supabase
      .from("ending_condition_rows")
      .select("id")
      .eq("condition_block_id", header.condition_block_id);
    const rowIds = (blockRows ?? []).map((r) => r.id as string);
    if (rowIds.length > 0) {
      await supabase
        .from("ending_condition_row_chips")
        .delete()
        .eq("variable_id", header.variable_id)
        .in("row_id", rowIds);
    }
  }
  const { error } = await supabase
    .from("ending_condition_block_variables")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

// --- Chips --------------------------------------------------------------

export async function addChip(input: {
  row_id: string;
  variable_id: string;
  operator?: EndingChipOperator;
  text_value_id?: string | null;
  number_value?: number | null;
  aggregate_value?: string | null;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("ending_condition_row_chips")
    .select("sort_order")
    .eq("row_id", input.row_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;

  const operator: EndingChipOperator = input.operator ?? "=";
  const text_value_id = input.text_value_id ?? null;
  const number_value = input.number_value ?? null;
  const aggregate_value = input.aggregate_value ?? null;
  const filled = [text_value_id, number_value, aggregate_value].filter(
    (v) => v != null
  ).length;
  if (filled !== 1) {
    throw new Error(
      "addChip: exactly one of text_value_id, number_value, or aggregate_value is required."
    );
  }

  const { data, error } = await supabase
    .from("ending_condition_row_chips")
    .insert({
      row_id: input.row_id,
      variable_id: input.variable_id,
      operator,
      text_value_id,
      number_value,
      aggregate_value,
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Phase 6 invariant: a row's chip's variable must be declared on the
  // parent block's header. Auto-add when missing so older flows keep
  // working.
  const { data: row } = await supabase
    .from("ending_condition_rows")
    .select("condition_block_id")
    .eq("id", input.row_id)
    .single();
  if (row) {
    await addBlockVariable({
      block_id: row.condition_block_id as string,
      variable_id: input.variable_id,
    });
  }
  revalidateEndings();
  return { id: data.id as string };
}

export async function deleteChip(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase
    .from("ending_condition_row_chips")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

// --- Inline variable + value creation -----------------------------------

export async function createVariableInline(input: {
  name: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const name = input.name.trim();
  if (!name) throw new Error("Variable name cannot be empty.");
  const { data: existing } = await supabase
    .from("ending_variables")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const id = randomUUID();
  const { data, error } = await supabase
    .from("ending_variables")
    .insert({
      id,
      name,
      kind: "text",
      number_ref: null,
      color_index: colorIndexFor(id),
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data.id as string };
}

export async function createValueInline(input: {
  variable_id: string;
  value: string;
  set_as_default?: boolean;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const text = input.value.trim();
  if (!text) throw new Error("Value cannot be empty.");
  const { data: existing } = await supabase
    .from("ending_variable_values")
    .select("sort_order")
    .eq("variable_id", input.variable_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const { data, error } = await supabase
    .from("ending_variable_values")
    .insert({
      variable_id: input.variable_id,
      value: text,
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { data: anyDefault } = await supabase
    .from("ending_variables")
    .select("default_value_id")
    .eq("id", input.variable_id)
    .single();
  if (input.set_as_default || !anyDefault?.default_value_id) {
    await supabase
      .from("ending_variables")
      .update({ default_value_id: data.id })
      .eq("id", input.variable_id);
  }
  revalidateEndings();
  return { id: data.id as string };
}

// --- saveDocument: UPDATE-only across blocks + rows + chips + headers --

export type BlockPayload = {
  id: string;
  parent_block_id: string | null;
  parent_row_id: string | null;
  block_type: EndingBlockType;
  /** When block_type='text', the text. Null for non-text blocks. */
  text: string | null;
  /** When block_type='result' or 'fallback', the result_value. Null
   *  for text/condition blocks; can also be null for an unset
   *  fallback. */
  result_value: string | null;
  sort_order: number;
};

export type RowPayload = {
  id: string;
  condition_block_id: string;
  sort_order: number;
};

export type ChipPayload = {
  id: string;
  row_id: string;
  variable_id: string;
  operator: EndingChipOperator;
  text_value_id: string | null;
  number_value: number | null;
  aggregate_value: string | null;
  sort_order: number;
};

export type BlockVariablePayload = {
  id: string;
  sort_order: number;
};

/**
 * Persist a document's tree. UPDATE-only — same invariant as the
 * pre-rebuild `saveFramework`. Inserts/deletes happen via the dedicated
 * add/delete actions. For framework documents `name` is required (and
 * trimmed); for logic documents `name` is ignored (it must remain null).
 */
export async function saveDocument(input: {
  document_id: string;
  name?: string | null;
  blocks: BlockPayload[];
  rows: RowPayload[];
  chips: ChipPayload[];
  header_vars?: BlockVariablePayload[];
}) {
  const supabase = await createSupabaseServerClient();
  const kind = await getDocumentKind(supabase, input.document_id);
  if (!kind) throw new Error(`Unknown document ${input.document_id}.`);

  if (kind === "framework") {
    const trimmed = (input.name ?? "").trim();
    if (!trimmed) throw new Error("Framework name cannot be empty.");
    const { error } = await supabase
      .from("ending_documents")
      .update({ name: trimmed })
      .eq("id", input.document_id);
    if (error) throw new Error(error.message);
  }

  // Pre-validate each block payload's leaf-vs-kind shape so a rogue
  // payload doesn't slip through into the DB.
  for (const b of input.blocks) {
    if (b.block_type === "text" && kind !== "framework") {
      throw new Error("Logic documents cannot contain text blocks.");
    }
    if (b.block_type === "result") {
      if (kind === "framework") {
        throw new Error("Framework documents cannot contain result blocks.");
      }
      if (b.result_value == null || b.result_value === "") {
        throw new Error("Result blocks require a result_value.");
      }
      await validateResultValue(supabase, kind, b.result_value);
    }
    if (b.block_type === "fallback") {
      if (kind !== "framework_selection") {
        throw new Error(
          "Fallback blocks only exist on the framework_selection document."
        );
      }
      // result_value can be null (initially unset). When set, it must
      // be a valid framework document_id.
      if (b.result_value != null && b.result_value !== "") {
        await validateResultValue(supabase, kind, b.result_value);
      }
    }
  }

  // Result-uniqueness across sibling groups. Editor-side moveBlock
  // already rejects invalid drags, but a malformed payload would
  // otherwise slip through into the DB.
  const groups = new Map<string, BlockPayload[]>();
  for (const b of input.blocks) {
    if (b.block_type === "fallback") continue;
    const key = `${b.parent_block_id ?? "root"}:${b.parent_row_id ?? "root"}`;
    const list = groups.get(key);
    if (list) list.push(b);
    else groups.set(key, [b]);
  }
  for (const list of groups.values()) {
    const hasResult = list.some((b) => b.block_type === "result");
    if (hasResult && list.length > 1) {
      throw new Error(
        "A result block must be the only block in its sibling group."
      );
    }
  }

  const blockUpdates = input.blocks.map(async (b) => {
    const text = b.block_type === "text" ? b.text : null;
    const result_value =
      b.block_type === "result"
        ? b.result_value
        : b.block_type === "fallback"
          ? b.result_value
          : null;
    const { error } = await supabase
      .from("ending_blocks")
      .update({
        parent_block_id: b.parent_block_id,
        parent_row_id: b.parent_row_id,
        block_type: b.block_type,
        text,
        result_value,
        sort_order: b.sort_order,
      })
      .eq("id", b.id);
    if (error) throw new Error(`block ${b.id}: ${error.message}`);
  });

  const rowUpdates = input.rows.map(async (r) => {
    const { error } = await supabase
      .from("ending_condition_rows")
      .update({
        condition_block_id: r.condition_block_id,
        sort_order: r.sort_order,
      })
      .eq("id", r.id);
    if (error) throw new Error(`row ${r.id}: ${error.message}`);
  });

  const chipUpdates = input.chips.map(async (c) => {
    const { error } = await supabase
      .from("ending_condition_row_chips")
      .update({
        row_id: c.row_id,
        variable_id: c.variable_id,
        operator: c.operator,
        text_value_id: c.text_value_id,
        number_value: c.number_value,
        aggregate_value: c.aggregate_value,
        sort_order: c.sort_order,
      })
      .eq("id", c.id);
    if (error) throw new Error(`chip ${c.id}: ${error.message}`);
  });

  const headerUpdates = (input.header_vars ?? []).map(async (bv) => {
    const { error } = await supabase
      .from("ending_condition_block_variables")
      .update({ sort_order: bv.sort_order })
      .eq("id", bv.id);
    if (error) throw new Error(`block_variable ${bv.id}: ${error.message}`);
  });

  await Promise.all([
    ...blockUpdates,
    ...rowUpdates,
    ...chipUpdates,
    ...headerUpdates,
  ]);

  revalidateEndings();
}
