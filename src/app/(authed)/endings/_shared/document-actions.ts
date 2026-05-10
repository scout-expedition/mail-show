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
  AGGREGATE_OPTIONS_BY_REF,
  ENDING_LOGIC_RESULT_OPTIONS_BY_KIND,
  isRandomSentinel,
  parseRandomSubset,
  parseRemoveSentinel,
  RANDOM_REMAINING_SENTINEL,
  RANDOM_SUBSET_SENTINEL_PREFIX,
  REMOVE_SENTINEL_PREFIX,
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
): Promise<Array<{ id: string; block_type: string; sort_order: number }>> {
  let q = supabase
    .from("ending_blocks")
    .select("id, block_type, sort_order")
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
  // Custom-subset random is only valid on framework_selection — the
  // payload is a JSON list of framework UUIDs to randomize over.
  // Reject any value that wears the prefix but doesn't parse, so
  // malformed payloads can't slip past the rest of the matchers.
  if (result_value.startsWith(RANDOM_SUBSET_SENTINEL_PREFIX)) {
    if (kind !== "framework_selection") {
      throw new Error(
        `Custom-subset random is only valid on framework_selection (got ${kind}).`
      );
    }
    const subset = parseRandomSubset(result_value);
    if (subset == null) {
      throw new Error(
        `Malformed random-subset result_value '${result_value}'.`
      );
    }
    const { data: subsetDocs, error } = await supabase
      .from("ending_documents")
      .select("id, kind")
      .in("id", subset);
    if (error) throw new Error(error.message);
    const found = new Map(
      (subsetDocs ?? []).map((d) => [d.id as string, d.kind as string])
    );
    for (const id of subset) {
      const docKind = found.get(id);
      if (docKind !== "framework") {
        throw new Error(
          `Invalid framework_selection subset entry '${id}': must be the id of a framework document.`
        );
      }
    }
    return;
  }
  // Set-narrowing sentinels are nation-tiebreak-only. `__remove__:X`
  // narrows the working set; `__random_remaining__` rolls from
  // whatever survives. Both rely on the set-narrowing evaluator,
  // which only kicks in for nation tiebreak docs.
  const isNationTiebreak =
    kind === "nation_affinity_top" || kind === "nation_affinity_bottom";
  if (result_value.startsWith(REMOVE_SENTINEL_PREFIX)) {
    if (!isNationTiebreak) {
      throw new Error(
        `Set-narrowing removals are only valid on nation tiebreak docs (got ${kind}).`
      );
    }
    const nation = parseRemoveSentinel(result_value);
    if (nation == null) {
      throw new Error(`Malformed remove result_value '${result_value}'.`);
    }
    if (!AGGREGATE_OPTIONS_BY_REF.nation_affinity.includes(nation)) {
      throw new Error(
        `Invalid removal target '${nation}': must be one of ${AGGREGATE_OPTIONS_BY_REF.nation_affinity.join(
          ", "
        )}.`
      );
    }
    return;
  }
  if (result_value === RANDOM_REMAINING_SENTINEL) {
    if (!isNationTiebreak) {
      throw new Error(
        `Random (between remaining) is only valid on nation tiebreak docs (got ${kind}).`
      );
    }
    return;
  }
  // Plain random sentinels (tied / all / legacy alias) are allowed on
  // every logic-kind doc. The evaluator expands them at call sites;
  // storage is just the literal.
  if (isRandomSentinel(result_value)) return;
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
  /** When set, insert before this sibling and shift later siblings'
   *  sort_orders by +1. When null/undefined, append (default). */
  before_block_id?: string | null;
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
): Promise<{ id: string }> {
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

  // Resolve insertion point. before_block_id pins the new block at
  // the target's sort_order and shifts later siblings down by 1; the
  // bare append path keeps the existing nextSiblingSort behavior.
  let insertSort: number;
  if (input.before_block_id) {
    const { data: target } = await supabase
      .from("ending_blocks")
      .select("sort_order")
      .eq("id", input.before_block_id)
      .single();
    if (!target) {
      throw new Error(
        `before_block_id ${input.before_block_id} not found.`
      );
    }
    insertSort = target.sort_order as number;
    // Shift all siblings with sort_order >= insertSort up by 1 to
    // make room. Operates on the fetched siblings list to avoid an
    // extra round-trip — fallback rows are already filtered out.
    const toShift = siblings.filter((b) => b.sort_order >= insertSort);
    if (toShift.length > 0) {
      // Two-step shift: bump up by a large offset first to dodge the
      // unique (parent, sort_order) constraint, then settle into the
      // intended slots. Without this, two rows could briefly collide
      // mid-update.
      for (const b of toShift) {
        const { error: bumpErr } = await supabase
          .from("ending_blocks")
          .update({ sort_order: b.sort_order + 100000 })
          .eq("id", b.id);
        if (bumpErr) throw new Error(bumpErr.message);
      }
      for (const b of toShift) {
        const { error: settleErr } = await supabase
          .from("ending_blocks")
          .update({ sort_order: b.sort_order + 1 })
          .eq("id", b.id);
        if (settleErr) throw new Error(settleErr.message);
      }
    }
  } else {
    insertSort = await nextSiblingSort(
      supabase,
      input.document_id,
      input.parent_block_id,
      input.parent_row_id
    );
  }

  const { data: block, error } = await supabase
    .from("ending_blocks")
    .insert({
      document_id: input.document_id,
      parent_block_id: input.parent_block_id,
      parent_row_id: input.parent_row_id,
      block_type: input.block_type,
      text: textValue,
      result_value: resultValue,
      sort_order: insertSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Condition blocks no longer seed a row at create-time — the first
  // row + default chip auto-create the moment the user adds the
  // block's first declared header variable (see addBlockVariable).
  // This avoids dangling empty rows on blocks the author abandons.
  revalidateEndings();
  return { id: block.id as string };
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

/**
 * Deep-clone a block + every row, chip, header-variable and child
 * block underneath it, inserting the clone immediately after the
 * original. Mirrors `addBlock`'s sibling-shift behaviour so the
 * existing siblings settle past the new clone in sort_order.
 *
 * Fallback blocks aren't author-created and a result block is
 * exclusive in its sibling group — both reject so the result-uniqueness
 * + fallback invariants stay intact.
 */
export async function duplicateBlock(input: {
  id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: original, error: lookupErr } = await supabase
    .from("ending_blocks")
    .select(
      "id, document_id, parent_block_id, parent_row_id, block_type, text, result_value, sort_order"
    )
    .eq("id", input.id)
    .single();
  if (lookupErr) throw new Error(lookupErr.message);
  if (!original) throw new Error(`Block ${input.id} not found.`);
  if (original.block_type === "fallback") {
    throw new Error("Fallback blocks can't be duplicated.");
  }
  if (original.block_type === "result") {
    // Sibling group already contains exactly one block (the original);
    // adding the clone alongside violates result-uniqueness.
    throw new Error("Result blocks can't be duplicated.");
  }

  // BFS-collect the subtree so we can remap ids in one pass.
  const blocks: Array<{
    id: string;
    document_id: string;
    parent_block_id: string | null;
    parent_row_id: string | null;
    block_type: string;
    text: string | null;
    result_value: string | null;
    sort_order: number;
  }> = [original as typeof blocks[number]];
  const rows: Array<{
    id: string;
    condition_block_id: string;
    sort_order: number;
  }> = [];
  const chips: Array<{
    row_id: string;
    variable_id: string;
    operator: EndingChipOperator;
    text_value_id: string | null;
    number_value: number | null;
    aggregate_value: string | null;
    sort_order: number;
  }> = [];
  const blockVars: Array<{
    condition_block_id: string;
    variable_id: string;
    sort_order: number;
  }> = [];

  let frontier: string[] = [original.id as string];
  while (frontier.length > 0) {
    const conditionIds = blocks
      .filter(
        (b) =>
          b.block_type === "condition" &&
          frontier.includes(b.id) === true
      )
      .map((b) => b.id);
    if (conditionIds.length > 0) {
      const [{ data: rowBatch }, { data: bvBatch }, { data: childBatch }] =
        await Promise.all([
          supabase
            .from("ending_condition_rows")
            .select("id, condition_block_id, sort_order")
            .in("condition_block_id", conditionIds),
          supabase
            .from("ending_condition_block_variables")
            .select("condition_block_id, variable_id, sort_order")
            .in("condition_block_id", conditionIds),
          supabase
            .from("ending_blocks")
            .select(
              "id, document_id, parent_block_id, parent_row_id, block_type, text, result_value, sort_order"
            )
            .in("parent_block_id", conditionIds),
        ]);
      const newRows = (rowBatch ?? []) as typeof rows;
      rows.push(...newRows);
      blockVars.push(...((bvBatch ?? []) as typeof blockVars));
      const newRowIds = newRows.map((r) => r.id);
      if (newRowIds.length > 0) {
        const { data: chipBatch } = await supabase
          .from("ending_condition_row_chips")
          .select(
            "row_id, variable_id, operator, text_value_id, number_value, aggregate_value, sort_order"
          )
          .in("row_id", newRowIds);
        chips.push(...((chipBatch ?? []) as typeof chips));
      }
      const newChildren = (childBatch ?? []) as typeof blocks;
      blocks.push(...newChildren);
      frontier = newChildren.map((b) => b.id);
    } else {
      frontier = [];
    }
  }

  // Build id maps for blocks + rows. Chips and block-variables don't
  // need stable ids of their own — they reference blocks/rows by FK.
  const blockIdMap = new Map<string, string>();
  for (const b of blocks) blockIdMap.set(b.id, randomUUID());
  const rowIdMap = new Map<string, string>();
  for (const r of rows) rowIdMap.set(r.id, randomUUID());

  // Insertion point: original.sort_order + 1, shift later siblings.
  const siblings = (
    await fetchSiblings(
      supabase,
      original.document_id,
      original.parent_block_id,
      original.parent_row_id
    )
  ).filter((b) => b.block_type !== "fallback");
  const insertSort = original.sort_order + 1;
  const toShift = siblings.filter(
    (b) => b.sort_order >= insertSort && b.id !== original.id
  );
  if (toShift.length > 0) {
    for (const b of toShift) {
      const { error: bumpErr } = await supabase
        .from("ending_blocks")
        .update({ sort_order: b.sort_order + 100000 })
        .eq("id", b.id);
      if (bumpErr) throw new Error(bumpErr.message);
    }
    for (const b of toShift) {
      const { error: settleErr } = await supabase
        .from("ending_blocks")
        .update({ sort_order: b.sort_order + 1 })
        .eq("id", b.id);
      if (settleErr) throw new Error(settleErr.message);
    }
  }

  // Insert the cloned blocks in the same order they were collected
  // (parents before children). The root takes insertSort; descendants
  // keep their relative sort_orders within their own parent.
  const newBlockRows = blocks.map((b) => ({
    id: blockIdMap.get(b.id)!,
    document_id: b.document_id,
    parent_block_id:
      b.id === original.id
        ? b.parent_block_id
        : blockIdMap.get(b.parent_block_id ?? "") ?? null,
    parent_row_id:
      b.id === original.id
        ? b.parent_row_id
        : rowIdMap.get(b.parent_row_id ?? "") ?? null,
    block_type: b.block_type,
    text: b.text,
    result_value: b.result_value,
    sort_order: b.id === original.id ? insertSort : b.sort_order,
  }));
  if (newBlockRows.length > 0) {
    const { error: insertBlocksErr } = await supabase
      .from("ending_blocks")
      .insert(newBlockRows);
    if (insertBlocksErr) throw new Error(insertBlocksErr.message);
  }

  if (rows.length > 0) {
    const newRows = rows.map((r) => ({
      id: rowIdMap.get(r.id)!,
      condition_block_id: blockIdMap.get(r.condition_block_id)!,
      sort_order: r.sort_order,
    }));
    const { error: insertRowsErr } = await supabase
      .from("ending_condition_rows")
      .insert(newRows);
    if (insertRowsErr) throw new Error(insertRowsErr.message);
  }

  if (blockVars.length > 0) {
    const newBlockVars = blockVars.map((bv) => ({
      condition_block_id: blockIdMap.get(bv.condition_block_id)!,
      variable_id: bv.variable_id,
      sort_order: bv.sort_order,
    }));
    const { error: insertBvErr } = await supabase
      .from("ending_condition_block_variables")
      .insert(newBlockVars);
    if (insertBvErr) throw new Error(insertBvErr.message);
  }

  if (chips.length > 0) {
    const newChips = chips.map((c) => ({
      row_id: rowIdMap.get(c.row_id)!,
      variable_id: c.variable_id,
      operator: c.operator,
      text_value_id: c.text_value_id,
      number_value: c.number_value,
      aggregate_value: c.aggregate_value,
      sort_order: c.sort_order,
    }));
    const { error: insertChipsErr } = await supabase
      .from("ending_condition_row_chips")
      .insert(newChips);
    if (insertChipsErr) throw new Error(insertChipsErr.message);
  }

  revalidateEndings();
  return { id: blockIdMap.get(original.id as string)! };
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

  // Auto-seed a chip on the parent block's first declared header
  // variable. Leaves under the row stay empty — authors add
  // text/result/condition blocks themselves via the row's insertion
  // zone, so unfinished rows don't leave behind a dangling text
  // block.
  const { data: firstHeader } = await supabase
    .from("ending_condition_block_variables")
    .select("variable_id")
    .eq("condition_block_id", input.block_id)
    .order("sort_order")
    .limit(1)
    .maybeSingle();
  if (firstHeader) {
    const chipDefaults = await computeDefaultChip(
      supabase,
      firstHeader.variable_id as string
    );
    if (chipDefaults) {
      const { error: chipErr } = await supabase
        .from("ending_condition_row_chips")
        .insert({
          row_id: data.id as string,
          variable_id: firstHeader.variable_id as string,
          ...chipDefaults,
          sort_order: 0,
        });
      if (chipErr) throw new Error(chipErr.message);
    }
  }

  revalidateEndings();
  return { id: data.id as string };
}

/**
 * Deep-clone a row + every chip on it + every block (and descendant)
 * underneath it. Inserts the clone immediately after the original row
 * and shifts later rows in the same condition block by +1.
 */
export async function duplicateRow(input: {
  id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: original, error: lookupErr } = await supabase
    .from("ending_condition_rows")
    .select("id, condition_block_id, sort_order")
    .eq("id", input.id)
    .single();
  if (lookupErr) throw new Error(lookupErr.message);
  if (!original) throw new Error(`Row ${input.id} not found.`);

  const conditionBlockId = original.condition_block_id as string;

  // Shift later rows down by 1 to make room. Two-step bump+settle to
  // dodge the unique (block, sort_order) constraint mid-update.
  const { data: later } = await supabase
    .from("ending_condition_rows")
    .select("id, sort_order")
    .eq("condition_block_id", conditionBlockId)
    .gt("sort_order", original.sort_order);
  const toShift = (later ?? []) as Array<{ id: string; sort_order: number }>;
  if (toShift.length > 0) {
    for (const r of toShift) {
      const { error: bumpErr } = await supabase
        .from("ending_condition_rows")
        .update({ sort_order: r.sort_order + 100000 })
        .eq("id", r.id);
      if (bumpErr) throw new Error(bumpErr.message);
    }
    for (const r of toShift) {
      const { error: settleErr } = await supabase
        .from("ending_condition_rows")
        .update({ sort_order: r.sort_order + 1 })
        .eq("id", r.id);
      if (settleErr) throw new Error(settleErr.message);
    }
  }

  // Insert the new row right after the original.
  const newRowId = randomUUID();
  const { error: rowErr } = await supabase
    .from("ending_condition_rows")
    .insert({
      id: newRowId,
      condition_block_id: conditionBlockId,
      sort_order: (original.sort_order as number) + 1,
    });
  if (rowErr) throw new Error(rowErr.message);

  // Clone chips on the original row.
  const { data: chipBatch } = await supabase
    .from("ending_condition_row_chips")
    .select(
      "variable_id, operator, text_value_id, number_value, aggregate_value, sort_order"
    )
    .eq("row_id", input.id);
  if (chipBatch && chipBatch.length > 0) {
    const newChips = chipBatch.map((c) => ({
      row_id: newRowId,
      variable_id: c.variable_id,
      operator: c.operator,
      text_value_id: c.text_value_id,
      number_value: c.number_value,
      aggregate_value: c.aggregate_value,
      sort_order: c.sort_order,
    }));
    const { error: chipErr } = await supabase
      .from("ending_condition_row_chips")
      .insert(newChips);
    if (chipErr) throw new Error(chipErr.message);
  }

  // BFS-collect the subtree rooted at child blocks under this row.
  const blocks: Array<{
    id: string;
    document_id: string;
    parent_block_id: string | null;
    parent_row_id: string | null;
    block_type: string;
    text: string | null;
    result_value: string | null;
    sort_order: number;
  }> = [];
  const childRows: Array<{
    id: string;
    condition_block_id: string;
    sort_order: number;
  }> = [];
  const childChips: Array<{
    row_id: string;
    variable_id: string;
    operator: EndingChipOperator;
    text_value_id: string | null;
    number_value: number | null;
    aggregate_value: string | null;
    sort_order: number;
  }> = [];
  const blockVars: Array<{
    condition_block_id: string;
    variable_id: string;
    sort_order: number;
  }> = [];

  // Seed the frontier with direct child blocks of the row.
  const { data: directChildren } = await supabase
    .from("ending_blocks")
    .select(
      "id, document_id, parent_block_id, parent_row_id, block_type, text, result_value, sort_order"
    )
    .eq("parent_row_id", input.id);
  blocks.push(...((directChildren ?? []) as typeof blocks));
  let frontier: string[] = blocks
    .filter((b) => b.block_type === "condition")
    .map((b) => b.id);

  while (frontier.length > 0) {
    const conditionIds = frontier;
    const [{ data: rowB }, { data: bvB }, { data: childB }] =
      await Promise.all([
        supabase
          .from("ending_condition_rows")
          .select("id, condition_block_id, sort_order")
          .in("condition_block_id", conditionIds),
        supabase
          .from("ending_condition_block_variables")
          .select("condition_block_id, variable_id, sort_order")
          .in("condition_block_id", conditionIds),
        supabase
          .from("ending_blocks")
          .select(
            "id, document_id, parent_block_id, parent_row_id, block_type, text, result_value, sort_order"
          )
          .in("parent_block_id", conditionIds),
      ]);
    const newRows = (rowB ?? []) as typeof childRows;
    childRows.push(...newRows);
    blockVars.push(...((bvB ?? []) as typeof blockVars));
    const newRowIds = newRows.map((r) => r.id);
    if (newRowIds.length > 0) {
      const { data: cB } = await supabase
        .from("ending_condition_row_chips")
        .select(
          "row_id, variable_id, operator, text_value_id, number_value, aggregate_value, sort_order"
        )
        .in("row_id", newRowIds);
      childChips.push(...((cB ?? []) as typeof childChips));
    }
    const newChildBlocks = (childB ?? []) as typeof blocks;
    blocks.push(...newChildBlocks);
    frontier = newChildBlocks
      .filter((b) => b.block_type === "condition")
      .map((b) => b.id);
  }

  // Build id maps. The original row maps to newRowId.
  const blockIdMap = new Map<string, string>();
  for (const b of blocks) blockIdMap.set(b.id, randomUUID());
  const rowIdMap = new Map<string, string>();
  rowIdMap.set(input.id, newRowId);
  for (const r of childRows) rowIdMap.set(r.id, randomUUID());

  if (blocks.length > 0) {
    const newBlocks = blocks.map((b) => ({
      id: blockIdMap.get(b.id)!,
      document_id: b.document_id,
      parent_block_id:
        b.parent_block_id && blockIdMap.has(b.parent_block_id)
          ? blockIdMap.get(b.parent_block_id)!
          : b.parent_block_id,
      parent_row_id:
        b.parent_row_id && rowIdMap.has(b.parent_row_id)
          ? rowIdMap.get(b.parent_row_id)!
          : b.parent_row_id,
      block_type: b.block_type,
      text: b.text,
      result_value: b.result_value,
      sort_order: b.sort_order,
    }));
    const { error: insertBlocksErr } = await supabase
      .from("ending_blocks")
      .insert(newBlocks);
    if (insertBlocksErr) throw new Error(insertBlocksErr.message);
  }

  if (childRows.length > 0) {
    const newChildRows = childRows.map((r) => ({
      id: rowIdMap.get(r.id)!,
      condition_block_id: blockIdMap.get(r.condition_block_id)!,
      sort_order: r.sort_order,
    }));
    const { error: rowErr2 } = await supabase
      .from("ending_condition_rows")
      .insert(newChildRows);
    if (rowErr2) throw new Error(rowErr2.message);
  }

  if (blockVars.length > 0) {
    const newBlockVars = blockVars.map((bv) => ({
      condition_block_id: blockIdMap.get(bv.condition_block_id)!,
      variable_id: bv.variable_id,
      sort_order: bv.sort_order,
    }));
    const { error: bvErr } = await supabase
      .from("ending_condition_block_variables")
      .insert(newBlockVars);
    if (bvErr) throw new Error(bvErr.message);
  }

  if (childChips.length > 0) {
    const newChildChips = childChips.map((c) => ({
      row_id: rowIdMap.get(c.row_id)!,
      variable_id: c.variable_id,
      operator: c.operator,
      text_value_id: c.text_value_id,
      number_value: c.number_value,
      aggregate_value: c.aggregate_value,
      sort_order: c.sort_order,
    }));
    const { error: chipErr2 } = await supabase
      .from("ending_condition_row_chips")
      .insert(newChildChips);
    if (chipErr2) throw new Error(chipErr2.message);
  }

  revalidateEndings();
  return { id: newRowId };
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
  let resultId: string;
  let isNewVariable: boolean;
  if (!data || data.length === 0) {
    const { data: existingRow } = await supabase
      .from("ending_condition_block_variables")
      .select("id")
      .eq("condition_block_id", input.block_id)
      .eq("variable_id", input.variable_id)
      .single();
    if (!existingRow)
      throw new Error("addBlockVariable: row missing post-upsert");
    resultId = existingRow.id as string;
    isNewVariable = false;
  } else {
    resultId = data[0].id as string;
    isNewVariable = true;
  }

  // Auto-seed the block's first row + default chip on the variable
  // being added the first time it's added to a block that has zero
  // rows. Skips the leaf-block seed (rows start empty until the
  // author adds a text/result/condition via the row toolbar).
  if (isNewVariable) {
    const { data: existingRows } = await supabase
      .from("ending_condition_rows")
      .select("id")
      .eq("condition_block_id", input.block_id)
      .limit(1);
    if (!existingRows || existingRows.length === 0) {
      const chipDefaults = await computeDefaultChip(
        supabase,
        input.variable_id
      );
      if (chipDefaults) {
        const { data: row, error: rowErr } = await supabase
          .from("ending_condition_rows")
          .insert({
            condition_block_id: input.block_id,
            sort_order: 0,
          })
          .select("id")
          .single();
        if (rowErr) throw new Error(rowErr.message);
        const { error: chipErr } = await supabase
          .from("ending_condition_row_chips")
          .insert({
            row_id: row.id as string,
            variable_id: input.variable_id,
            ...chipDefaults,
            sort_order: 0,
          });
        if (chipErr) throw new Error(chipErr.message);
      }
    }
  }

  revalidateEndings();
  return { id: resultId };
}

/**
 * Compute the default chip values for a freshly-added header variable.
 * Returns null when the variable is text-typed but has no values yet
 * (caller should skip auto-row creation in that case).
 */
async function computeDefaultChip(
  supabase: Supabase,
  variable_id: string
): Promise<{
  operator: EndingChipOperator;
  text_value_id: string | null;
  number_value: number | null;
  aggregate_value: string | null;
} | null> {
  const { data: variable } = await supabase
    .from("ending_variables")
    .select("kind, aggregate_ref, default_value_id")
    .eq("id", variable_id)
    .maybeSingle();
  if (!variable) return null;

  if (variable.kind === "text") {
    let textValueId = (variable.default_value_id as string | null) ?? null;
    if (!textValueId) {
      const { data: firstValue } = await supabase
        .from("ending_variable_values")
        .select("id")
        .eq("variable_id", variable_id)
        .order("sort_order")
        .limit(1)
        .maybeSingle();
      textValueId = (firstValue?.id as string | undefined) ?? null;
    }
    if (!textValueId) return null;
    return {
      operator: "=",
      text_value_id: textValueId,
      number_value: null,
      aggregate_value: null,
    };
  }

  if (variable.kind === "number_ref") {
    return {
      operator: "=",
      text_value_id: null,
      number_value: 0,
      aggregate_value: null,
    };
  }

  if (variable.kind === "aggregate_ref") {
    const aref = variable.aggregate_ref as
      | "nation_affinity"
      | "class_affinity"
      | "nation_tiebreak_set"
      | null;
    if (!aref) return null;
    const operator: EndingChipOperator =
      aref === "nation_tiebreak_set" ? "set_includes" : "top=";
    const aggregateValue = AGGREGATE_OPTIONS_BY_REF[aref]?.[0] ?? null;
    if (!aggregateValue) return null;
    return {
      operator,
      text_value_id: null,
      number_value: null,
      aggregate_value: aggregateValue,
    };
  }

  return null;
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
      if (
        kind !== "framework_selection" &&
        kind !== "class_affinity_top" &&
        kind !== "nation_affinity_top" &&
        kind !== "nation_affinity_bottom"
      ) {
        throw new Error(
          `Fallback blocks aren't seeded for ${kind}.`
        );
      }
      // result_value can be null (initially unset). When set, it must
      // be a valid result for the doc's kind (a framework UUID for
      // framework_selection; a class option for class_affinity_top; a
      // nation option for nation_affinity_*; or any random sentinel
      // accepted by the kind). validateResultValue handles all of them.
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
