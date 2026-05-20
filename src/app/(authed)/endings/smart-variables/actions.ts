"use server";

// Server actions for the Smart Variables page. Each smart variable is
// modeled as a paired (ending_documents, ending_variables) row: the doc
// holds the condition-block tree, the variable row is the public
// identity that surfaces in chip pickers across the rest of the
// endings UI.
//
// Block edits (condition/result/fallback patches, drag reorders, chip
// CRUD) reuse the shared actions in `_shared/document-actions.ts` — only
// the lifecycle here is doc-pair specific.

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { colorIndexFor } from "@/lib/endings/color-palette";
import {
  createScopedFolder,
  deleteScopedFolder,
  moveScopedFolder,
  moveScopedVariable,
  patchScopedFolder,
} from "../_shared/folder-actions";

function revalidateEndings() {
  revalidatePath("/endings/variables");
  revalidatePath("/endings/smart-variables");
  revalidatePath("/endings/logic");
  revalidatePath("/endings/frameworks");
  revalidatePath("/inspection/letters");
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function uniqueSmartVariableName(
  supabase: Supabase,
  base: string
): Promise<string> {
  // Smart Variable creation writes to BOTH ending_documents (partial
  // unique on smart_variable kind) and ending_variables (whole-table
  // unique on name). Probe both so the chosen name doesn't collide on
  // either table — including any legacy state where a doc was renamed
  // without its paired variable name (pre-trigger).
  let name = base;
  for (let i = 2; ; i++) {
    const [{ data: docHit }, { data: varHit }] = await Promise.all([
      supabase
        .from("ending_documents")
        .select("id")
        .eq("kind", "smart_variable")
        .eq("name", name)
        .maybeSingle(),
      supabase
        .from("ending_variables")
        .select("id")
        .eq("name", name)
        .maybeSingle(),
    ]);
    if (!docHit && !varHit) return name;
    name = `${base} ${i}`;
  }
}

/**
 * Create a Smart Variable: inserts the paired (doc, variable, fallback
 * block) triple in one go. Returns the new ids so the caller can
 * navigate to the new variable immediately.
 *
 * Falls back-block creation deliberately bypasses the user-facing
 * `addBlock` rejection (fallback blocks aren't author-created elsewhere).
 * The block starts with `result_value` null — the user fills it in via
 * the fallback picker / text input.
 */
export async function createSmartVariable(input: {
  name?: string;
  folderId?: string | null;
} = {}): Promise<{
  documentId: string;
  variableId: string;
  fallbackBlockId: string;
}> {
  const supabase = await createSupabaseServerClient();

  const { data: existingDocs } = await supabase
    .from("ending_documents")
    .select("sort_order")
    .eq("kind", "smart_variable")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextDocSort = (existingDocs?.[0]?.sort_order ?? 0) + 1;

  const { data: existingVars } = await supabase
    .from("ending_variables")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextVarSort = (existingVars?.[0]?.sort_order ?? 0) + 1;

  const baseName = input.name?.trim() || "New Smart Variable";
  const name = await uniqueSmartVariableName(supabase, baseName);
  const documentId = randomUUID();
  const variableId = randomUUID();
  const folderId = input.folderId ?? null;

  // 1) Doc.
  const { error: docErr } = await supabase.from("ending_documents").insert({
    id: documentId,
    kind: "smart_variable",
    name,
    sort_order: nextDocSort,
  });
  if (docErr) throw new Error(docErr.message);

  // 2) Paired variable row. Folder scope is enforced by trigger: a
  // smart_ref row must reference a 'smart_variable'-scope folder (or
  // null root).
  const { error: varErr } = await supabase.from("ending_variables").insert({
    id: variableId,
    name,
    kind: "smart_ref",
    number_ref: null,
    aggregate_ref: null,
    smart_variable_doc_id: documentId,
    color_index: colorIndexFor(variableId),
    sort_order: nextVarSort,
    folder_id: folderId,
  });
  if (varErr) {
    // Best-effort cleanup so the orphan doc doesn't linger.
    await supabase.from("ending_documents").delete().eq("id", documentId);
    throw new Error(varErr.message);
  }

  // 3) Fallback block — singleton at the document root. result_value
  // starts as null (unset); the user fills it in the editor.
  const { data: fallbackRow, error: fallbackErr } = await supabase
    .from("ending_blocks")
    .insert({
      document_id: documentId,
      parent_block_id: null,
      parent_row_id: null,
      block_type: "fallback",
      text: null,
      result_value: null,
      sort_order: 1000,
    })
    .select("id")
    .single();
  if (fallbackErr) {
    await supabase.from("ending_documents").delete().eq("id", documentId);
    throw new Error(fallbackErr.message);
  }

  revalidateEndings();
  return {
    documentId,
    variableId,
    fallbackBlockId: fallbackRow.id as string,
  };
}

/**
 * Rename a Smart Variable. Updates both the doc and the paired variable
 * row's name so the chip-picker label stays in sync with the editor
 * header. patchDocument already handles uniqueness + trimming.
 */
export async function renameSmartVariable(input: {
  documentId: string;
  name: string;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Smart Variable name cannot be empty.");

  const { data: doc } = await supabase
    .from("ending_documents")
    .select("kind")
    .eq("id", input.documentId)
    .maybeSingle();
  if (!doc) throw new Error(`Unknown Smart Variable ${input.documentId}.`);
  if (doc.kind !== "smart_variable") {
    throw new Error("renameSmartVariable: not a Smart Variable.");
  }

  // Uniqueness check across BOTH tables. ending_documents has a partial
  // unique index on smart_variable kind; ending_variables has a
  // whole-table unique on name. Either would reject the rename, so probe
  // both up front to surface a clean error before doing partial writes.
  const escaped = trimmed.replace(/[\\%_]/g, "\\$&");
  const [{ data: docConflict }, { data: varConflict }] = await Promise.all([
    supabase
      .from("ending_documents")
      .select("id")
      .eq("kind", "smart_variable")
      .ilike("name", escaped)
      .neq("id", input.documentId)
      .maybeSingle(),
    supabase
      .from("ending_variables")
      .select("id, smart_variable_doc_id")
      .ilike("name", escaped)
      .neq("smart_variable_doc_id", input.documentId)
      .maybeSingle(),
  ]);
  if (docConflict || varConflict) {
    throw new Error(`Duplicate Smart Variable name: ${trimmed}`);
  }

  const { error: docErr } = await supabase
    .from("ending_documents")
    .update({ name: trimmed })
    .eq("id", input.documentId);
  if (docErr) throw new Error(docErr.message);

  const { error: varErr } = await supabase
    .from("ending_variables")
    .update({ name: trimmed })
    .eq("smart_variable_doc_id", input.documentId);
  if (varErr) throw new Error(varErr.message);

  revalidateEndings();
}

/**
 * Delete a Smart Variable. Cascading FK on the paired variable row
 * cleans up automatically; all condition-block / chip / fallback rows
 * cascade off the doc's `ending_blocks` FK.
 */
export async function deleteSmartVariable(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { data: doc } = await supabase
    .from("ending_documents")
    .select("kind")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return;
  if (doc.kind !== "smart_variable") {
    throw new Error("deleteSmartVariable: not a Smart Variable.");
  }
  const { error } = await supabase
    .from("ending_documents")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

/**
 * Set the chip color for a Smart Variable. Writes to the paired
 * variable row's `color_hex` (the doc itself has no color column).
 * Passing null clears the override and falls back to
 * `paletteColor(color_index)`.
 */
export async function setSmartVariableColor(input: {
  documentId: string;
  color_hex: string | null;
}): Promise<void> {
  const supabase = await createSupabaseServerClient();
  let next: string | null = input.color_hex;
  if (next !== null) {
    const trimmed = next.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      throw new Error(`Invalid color hex: ${trimmed}`);
    }
    next = trimmed;
  }
  const { error } = await supabase
    .from("ending_variables")
    .update({ color_hex: next })
    .eq("smart_variable_doc_id", input.documentId);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

// Folder + move actions for the Smart Variables left rail. Each
// delegates to the scope-aware shared helpers in
// `_shared/folder-actions.ts` and revalidates the same paths as the
// other Smart Variables mutations.

export async function createSmartVariableFolder(input?: {
  id?: string;
  parentFolderId?: string | null;
  name?: string;
}): Promise<{ id: string }> {
  const result = await createScopedFolder({
    scope: "smart_variable",
    parentFolderId: input?.parentFolderId ?? null,
    id: input?.id,
    name: input?.name,
  });
  revalidateEndings();
  return result;
}

export async function renameSmartVariableFolder(input: {
  id: string;
  name: string;
}): Promise<void> {
  await patchScopedFolder({
    scope: "smart_variable",
    id: input.id,
    patch: { name: input.name },
  });
  revalidateEndings();
}

export async function moveSmartVariableFolder(input: {
  folderId: string;
  parentFolderId: string | null;
  beforeId: string | null;
}): Promise<void> {
  await moveScopedFolder({
    scope: "smart_variable",
    folderId: input.folderId,
    parentFolderId: input.parentFolderId,
    beforeId: input.beforeId,
  });
  revalidateEndings();
}

export async function deleteSmartVariableFolder(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteScopedFolder({ scope: "smart_variable", id });
  revalidateEndings();
}

export async function moveSmartVariableToFolder(input: {
  variableId: string;
  folderId: string | null;
  beforeId: string | null;
}): Promise<void> {
  await moveScopedVariable({
    variableKind: "smart_ref",
    variableId: input.variableId,
    folderId: input.folderId,
    beforeId: input.beforeId,
  });
  revalidateEndings();
}

