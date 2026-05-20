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
 * Narrow per-field patch for `ending_documents`. Frameworks accept
 * `name` (trimmed, non-empty, unique across frameworks) and `sort_order`.
 * Logic docs are anonymous singletons — only `sort_order` is accepted.
 * Does NOT call revalidatePath; realtime fans out via postgres_changes.
 */
export async function patchDocument(
  id: string,
  patch: Partial<{ name: string; sort_order: number }>
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const kind = await getDocumentKind(supabase, id);
  if (!kind) throw new Error(`Unknown document ${id}.`);

  const sanitized: typeof patch = { ...patch };

  if (sanitized.name !== undefined) {
    if (kind !== "framework" && kind !== "smart_variable") {
      throw new Error(
        "Only framework or smart_variable documents can be renamed."
      );
    }
    const trimmed = sanitized.name.trim();
    if (!trimmed) {
      throw new Error(
        kind === "framework"
          ? "Framework name cannot be empty."
          : "Smart Variable name cannot be empty."
      );
    }
    const { data: conflict } = await supabase
      .from("ending_documents")
      .select("id")
      .eq("kind", kind)
      .ilike("name", trimmed.replace(/[\\%_]/g, "\\$&"))
      .neq("id", id)
      .maybeSingle();
    if (conflict) {
      throw new Error(
        kind === "framework"
          ? `Duplicate framework name: ${trimmed}`
          : `Duplicate Smart Variable name: ${trimmed}`
      );
    }
    sanitized.name = trimmed;
  }

  const { error } = await supabase
    .from("ending_documents")
    .update(sanitized)
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Smart Variables are paired 1:1 with an `ending_variables` row of
  // kind='smart_ref' — that variable row is the public identity used by
  // every chip picker across endings + frameworks. Keep the two names in
  // sync so renaming in the editor immediately propagates to every
  // surface that reads `ending_variables.name`. A DB trigger also enforces
  // this invariant, but doing it here too keeps the rejected-name error
  // surface in app code where the caller can react to it.
  if (sanitized.name !== undefined && kind === "smart_variable") {
    const { error: varErr } = await supabase
      .from("ending_variables")
      .update({ name: sanitized.name })
      .eq("smart_variable_doc_id", id);
    if (varErr) throw new Error(varErr.message);
  }
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
  // Smart Variables accept any non-empty string. The free-text result IS
  // the variable's resolved value at evaluation time. No need to walk
  // the sentinel matchers below.
  if (kind === "smart_variable") {
    if (result_value === "") {
      throw new Error("Smart Variable result blocks require a result value.");
    }
    return;
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
    // Smart Variables author the result inline as free text, so we let
    // a fresh result block start with an empty string. Other doc kinds
    // require the picker to commit a value before save.
    if (input.result_value == null || input.result_value === "") {
      if (kind !== "smart_variable") {
        throw new Error("Result blocks require a result_value.");
      }
      resultValue = "";
    } else {
      await validateResultValue(supabase, kind, input.result_value);
      resultValue = input.result_value;
    }
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
 * Narrow per-field patch for `ending_blocks`. Whitelisted columns:
 * `text` (text blocks only), `result_value` (result + fallback blocks),
 * `summary`, and `sort_order`. block_type, parent_block_id, and
 * parent_row_id are intentionally NOT patchable — moves go through
 * reorderTree so the result-uniqueness invariant holds. Validates
 * leaf-vs-kind shape and the result-value against the parent document's
 * kind. Does NOT call revalidatePath; realtime fans out the change.
 */
export async function patchBlock(
  id: string,
  patch: Partial<{
    text: string | null;
    result_value: string | null;
    summary: string | null;
    sort_order: number;
  }>
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("ending_blocks")
    .select("document_id, block_type, result_value")
    .eq("id", id)
    .maybeSingle();
  if (!existing) throw new Error(`Unknown block ${id}.`);
  const blockType = existing.block_type as EndingBlockType;
  const oldResultValue = (existing.result_value as string | null) ?? null;

  const sanitized: typeof patch = { ...patch };

  if (sanitized.text !== undefined) {
    if (blockType !== "text") {
      throw new Error("`text` is only patchable on text blocks.");
    }
  }

  // Smart Variables route the result_value patch through an RPC so the
  // block update + the chip-rename migration run as one transaction.
  // Non-smart_variable docs still use the regular UPDATE path below.
  let smartVariableRpc = false;
  if (sanitized.result_value !== undefined) {
    if (blockType !== "result" && blockType !== "fallback") {
      throw new Error("`result_value` is only patchable on result/fallback blocks.");
    }
    const kind = await getDocumentKind(
      supabase,
      existing.document_id as string
    );
    if (!kind) throw new Error(`Unknown document ${existing.document_id}.`);
    if (sanitized.result_value != null && sanitized.result_value !== "") {
      await validateResultValue(supabase, kind, sanitized.result_value);
    } else if (blockType === "result" && kind !== "smart_variable") {
      // Smart Variables let authors clear the result mid-edit — empty
      // string is a valid transient state since the user types it
      // inline (clearing for a moment before typing the next value).
      throw new Error("Result blocks require a result_value.");
    }
    smartVariableRpc = kind === "smart_variable";
  }

  if (smartVariableRpc) {
    // The RPC writes `result_value` AND migrates chips referencing
    // the OLD value to the new one in a single Postgres transaction
    // (see migration 20260520150000). Other patch fields (summary,
    // sort_order) commit separately when present — they're block-local
    // and don't need the atomicity guarantee.
    void oldResultValue;
    const newValue = (sanitized.result_value ?? "") as string;
    const { error: rpcErr } = await supabase.rpc(
      "update_smart_variable_block_result",
      { p_block_id: id, p_new_value: newValue }
    );
    if (rpcErr) throw new Error(rpcErr.message);
    const restPatch: typeof sanitized = { ...sanitized };
    delete restPatch.result_value;
    if (Object.keys(restPatch).length > 0) {
      const { error: restErr } = await supabase
        .from("ending_blocks")
        .update(restPatch)
        .eq("id", id);
      if (restErr) throw new Error(restErr.message);
    }
    return;
  }

  const { error } = await supabase
    .from("ending_blocks")
    .update(sanitized)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Deep-clone a block + every row, chip, header-variable and child
 * block underneath it, inserting the clone immediately after the
 * original. Runs as a single Postgres transaction via the
 * `duplicate_ending_block` RPC (migration 0038), so a failure
 * mid-clone rolls back cleanly — no partial subtree, no orphaned
 * sibling sort_order shifts (GitHub issue #36).
 *
 * Fallback blocks aren't author-created and a result block is
 * exclusive in its sibling group — the RPC rejects both so the
 * result-uniqueness + fallback invariants stay intact.
 */
export async function duplicateBlock(input: {
  id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("duplicate_ending_block", {
    p_block_id: input.id,
  });
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data as string };
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
 * and shifts later rows in the same condition block by +1. Runs as a
 * single Postgres transaction via the `duplicate_ending_row` RPC
 * (migration 0038), so a failure mid-clone rolls back cleanly — no
 * partial subtree, no orphaned row sort_order shifts (GitHub issue #36).
 */
export async function duplicateRow(input: {
  id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("duplicate_ending_row", {
    p_row_id: input.id,
  });
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data as string };
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

/**
 * Narrow per-field patch for `ending_condition_rows`. Only `sort_order`
 * is patchable — moves between condition blocks go through reorderTree.
 * Does NOT call revalidatePath; realtime fans out the change.
 */
export async function patchRow(
  id: string,
  patch: Partial<{ sort_order: number }>
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("ending_condition_rows")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
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

  if (variable.kind === "smart_ref") {
    // Smart variables compare against a free-text string stored in
    // aggregate_value. Seed with an empty string so the chip satisfies
    // the value-shape CHECK (exactly one slot non-null) on first save
    // — the user fills it in via the dropdown. Mirrors the client-side
    // chip-adder behavior in condition-block.tsx so the two paths
    // don't diverge.
    return {
      operator: "=",
      text_value_id: null,
      number_value: null,
      aggregate_value: "",
    };
  }

  return null;
}

/**
 * Narrow per-field patch for `ending_condition_block_variables`.
 * Whitelisted: `variable_id` (swap which variable this header slot is
 * bound to) and `sort_order`. Does NOT call revalidatePath; realtime
 * fans out the change.
 *
 * NOTE: variable_id swaps don't auto-rewrite chip rows underneath this
 * header. Callers either delete + re-add the header (existing flow) or
 * swap deliberately and update affected chips themselves.
 */
export async function patchBlockVariable(
  id: string,
  patch: Partial<{ variable_id: string; sort_order: number }>
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("ending_condition_block_variables")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
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

/**
 * Narrow per-field patch for `ending_condition_row_chips`. Whitelisted:
 * variable_id, operator, text_value_id, number_value, aggregate_value,
 * sort_order. row_id is NOT patchable — chip moves go through reorderTree.
 *
 * Validates that exactly one of {text_value_id, number_value,
 * aggregate_value} is non-null after applying the patch, and that the
 * operator matches the (final) variable's kind. Does NOT call
 * revalidatePath; realtime fans out the change.
 */
export async function patchChip(
  id: string,
  patch: Partial<{
    variable_id: string;
    operator: EndingChipOperator;
    text_value_id: string | null;
    number_value: number | null;
    aggregate_value: string | null;
    sort_order: number;
  }>
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("ending_condition_row_chips")
    .select(
      "variable_id, operator, text_value_id, number_value, aggregate_value, row_id"
    )
    .eq("id", id)
    .maybeSingle();
  if (!existing) throw new Error(`Unknown chip ${id}.`);

  // Compose the post-patch chip shape so the value-slot + operator
  // invariants are enforced on the merged state, not the partial patch.
  const merged = {
    variable_id: patch.variable_id ?? (existing.variable_id as string),
    operator: patch.operator ?? (existing.operator as EndingChipOperator),
    text_value_id:
      patch.text_value_id !== undefined
        ? patch.text_value_id
        : (existing.text_value_id as string | null),
    number_value:
      patch.number_value !== undefined
        ? patch.number_value
        : (existing.number_value as number | null),
    aggregate_value:
      patch.aggregate_value !== undefined
        ? patch.aggregate_value
        : (existing.aggregate_value as string | null),
  };
  // The DB CHECK constraint `ending_condition_row_chips_value_shape`
  // requires EXACTLY one value slot non-null — a chip always compares
  // against something. Reject here so the caller gets a clean message
  // instead of a raw Postgres constraint-violation string. The editor
  // also skips the commit for transient invalid states (a half-cleared
  // number field), so this path is the last line of defense.
  const filled = [
    merged.text_value_id,
    merged.number_value,
    merged.aggregate_value,
  ].filter((v) => v != null).length;
  if (filled !== 1) {
    throw new Error(
      "A chip must compare against exactly one value. Remove the chip instead of clearing its value."
    );
  }

  // Operator must match the variable's kind.
  const { data: variable } = await supabase
    .from("ending_variables")
    .select("kind")
    .eq("id", merged.variable_id)
    .maybeSingle();
  if (!variable) {
    throw new Error(`patchChip: variable ${merged.variable_id} not found.`);
  }
  const kind = variable.kind as
    | "text"
    | "number_ref"
    | "aggregate_ref"
    | "smart_ref";
  const validOperators = {
    text: ["=", "≠"],
    number_ref: ["=", "≠", "<", "≤", ">", "≥"],
    aggregate_ref: [
      "top=",
      "top≠",
      "bottom=",
      "bottom≠",
      "set_includes",
      "set_excludes",
    ],
    // Smart Variables compare against a free-text string in
    // `aggregate_value`; only equality operators are meaningful.
    smart_ref: ["=", "≠"],
  }[kind];
  if (!validOperators.includes(merged.operator)) {
    throw new Error(
      `patchChip: operator '${merged.operator}' is not valid for variable kind '${kind}'.`
    );
  }

  const { error } = await supabase
    .from("ending_condition_row_chips")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Phase 6 invariant: if variable_id changed, ensure the new variable
  // is declared on the parent block's header. Cities/citizens-style
  // patches are narrow; we do this fixup so the editor never has to.
  if (patch.variable_id && patch.variable_id !== existing.variable_id) {
    const { data: row } = await supabase
      .from("ending_condition_rows")
      .select("condition_block_id")
      .eq("id", existing.row_id as string)
      .maybeSingle();
    if (row) {
      await addBlockVariable({
        block_id: row.condition_block_id as string,
        variable_id: patch.variable_id,
      });
    }
  }
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
  /** Authoring-only header label. Null when unset. */
  summary: string | null;
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
 * @deprecated Bulk-save path used by the legacy editor. The new editor
 * commits each field through patchBlock / patchChip / patchRow /
 * patchBlockVariable / patchDocument, and structural reorders through
 * reorderTree. Kept exported only for the integration test suite until
 * those tests migrate.
 *
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
        summary: b.summary,
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

/**
 * Structural reorder for a single document — bulk-updates sort_order
 * + parent_block_id + parent_row_id across blocks, rows, chips, and
 * header variables.
 *
 * Per-field patches (patchBlock/patchRow/patchChip/patchBlockVariable)
 * intentionally don't allow moving between parents — moves go through
 * this action so the result-uniqueness invariant is enforced once
 * across the full post-move state.
 *
 * Result-uniqueness is checked against the MERGED post-move state:
 * the proposed positions for moved blocks plus the current positions
 * of unchanged blocks at the affected destination groups. Without the
 * merge, dropping a text block into a sibling group that already
 * holds a (non-moved) result block evades validation.
 *
 * The endings schema has no unique (parent, sort_order) constraint,
 * so intermediate duplicate sort_order values during the bulk update
 * are harmless — we update each row directly without a shift dance.
 *
 * Does NOT call revalidatePath; realtime fans out the change.
 */
export async function reorderTree(input: {
  document_id: string;
  blocks: Array<{
    id: string;
    parent_block_id: string | null;
    parent_row_id: string | null;
    sort_order: number;
  }>;
  rows: Array<{ id: string; condition_block_id: string; sort_order: number }>;
  chips: Array<{ id: string; row_id: string; sort_order: number }>;
  header_vars: Array<{ id: string; sort_order: number }>;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();

  if (input.blocks.length > 0) {
    // Merge proposed moves with the current document state so the
    // result-uniqueness check sees the full post-move composition of
    // each affected sibling group — not just the moved blocks.
    const { data: existing, error: fetchErr } = await supabase
      .from("ending_blocks")
      .select("id, parent_block_id, parent_row_id, block_type")
      .eq("document_id", input.document_id);
    if (fetchErr) throw new Error(fetchErr.message);

    const proposedById = new Map(input.blocks.map((b) => [b.id, b]));
    type Merged = {
      id: string;
      parent_block_id: string | null;
      parent_row_id: string | null;
      block_type: EndingBlockType;
    };
    const merged: Merged[] = ((existing ?? []) as Array<{
      id: string;
      parent_block_id: string | null;
      parent_row_id: string | null;
      block_type: EndingBlockType;
    }>).map((b) => {
      const proposed = proposedById.get(b.id);
      return {
        id: b.id,
        parent_block_id: proposed ? proposed.parent_block_id : b.parent_block_id,
        parent_row_id: proposed ? proposed.parent_row_id : b.parent_row_id,
        block_type: b.block_type,
      };
    });

    const groups = new Map<string, Merged[]>();
    for (const b of merged) {
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
  }

  // Single-pass updates — no unique-sort_order constraint to dodge.
  await Promise.all([
    ...input.blocks.map(async (b) => {
      const { error } = await supabase
        .from("ending_blocks")
        .update({
          parent_block_id: b.parent_block_id,
          parent_row_id: b.parent_row_id,
          sort_order: b.sort_order,
        })
        .eq("id", b.id);
      if (error) throw new Error(`block ${b.id}: ${error.message}`);
    }),
    ...input.rows.map(async (r) => {
      const { error } = await supabase
        .from("ending_condition_rows")
        .update({
          condition_block_id: r.condition_block_id,
          sort_order: r.sort_order,
        })
        .eq("id", r.id);
      if (error) throw new Error(`row ${r.id}: ${error.message}`);
    }),
    ...input.chips.map(async (c) => {
      const { error } = await supabase
        .from("ending_condition_row_chips")
        .update({
          row_id: c.row_id,
          sort_order: c.sort_order,
        })
        .eq("id", c.id);
      if (error) throw new Error(`chip ${c.id}: ${error.message}`);
    }),
    ...input.header_vars.map(async (bv) => {
      const { error } = await supabase
        .from("ending_condition_block_variables")
        .update({ sort_order: bv.sort_order })
        .eq("id", bv.id);
      if (error) throw new Error(`block_variable ${bv.id}: ${error.message}`);
    }),
  ]);
}
