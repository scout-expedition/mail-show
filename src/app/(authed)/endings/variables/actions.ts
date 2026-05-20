"use server";

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
  revalidatePath("/endings/logic");
  revalidatePath("/endings/frameworks");
  revalidatePath("/inspection/letters");
}

async function uniqueName(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: "ending_variables",
  base: string
): Promise<string> {
  let name = base;
  for (let i = 2; ; i++) {
    const { data } = await supabase
      .from(table)
      .select("id")
      .eq("name", name)
      .maybeSingle();
    if (!data) return name;
    name = `${base} ${i}`;
  }
}

async function uniqueValueForVariable(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  variable_id: string,
  base: string
): Promise<string> {
  let value = base;
  for (let i = 2; ; i++) {
    const { data } = await supabase
      .from("ending_variable_values")
      .select("id")
      .eq("variable_id", variable_id)
      .eq("value", value)
      .maybeSingle();
    if (!data) return value;
    value = `${base} ${i}`;
  }
}

/**
 * Create a text variable. The 10 impact-column number_ref variables are
 * pre-seeded by migration 0016 and never created through this path.
 */
export async function createEndingVariable(
  input?: { id?: string; folder_id?: string | null }
): Promise<{ id: string; name: string }> {
  const supabase = await createSupabaseServerClient();

  // Take the next sort_order ignoring the seeded number_ref slots (which
  // sit at 10000+ to keep them at the bottom of the chip-picker list).
  const { data: existing } = await supabase
    .from("ending_variables")
    .select("sort_order")
    .eq("kind", "text")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const name = await uniqueName(supabase, "ending_variables", "New variable");
  const id = input?.id ?? randomUUID();
  const { error } = await supabase.from("ending_variables").insert({
    id,
    name,
    kind: "text",
    number_ref: null,
    color_index: colorIndexFor(id),
    sort_order: nextSort,
    folder_id: input?.folder_id ?? null,
  });
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id, name };
}

/**
 * Create a text variable + a single value in one round-trip, used by the
 * "+ New variable…" inline path in the frameworks chip pickers. Returns
 * the ids so the caller can immediately reference them.
 */
export async function createEndingVariableInline(input: {
  name: string;
  firstValue: string;
  /** Optional folder to place the new variable into; null = root. */
  folder_id?: string | null;
  /** Optional color override; otherwise the palette index seeds the
   *  swatch via paletteColor(color_index). */
  color_hex?: string | null;
}): Promise<{ variableId: string; valueId: string }> {
  const supabase = await createSupabaseServerClient();
  const trimmedName = input.name.trim();
  const trimmedValue = input.firstValue.trim();
  if (!trimmedName) throw new Error("Variable name is required.");
  if (!trimmedValue) throw new Error("First value is required.");
  if (input.color_hex && !/^#[0-9a-fA-F]{6}$/.test(input.color_hex)) {
    throw new Error(`Invalid color "${input.color_hex}" — expected #RRGGBB.`);
  }

  const { data: existing } = await supabase
    .from("ending_variables")
    .select("sort_order")
    .eq("kind", "text")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const variableId = randomUUID();
  const valueId = randomUUID();

  const { error: varErr } = await supabase.from("ending_variables").insert({
    id: variableId,
    name: trimmedName,
    kind: "text",
    number_ref: null,
    color_index: colorIndexFor(variableId),
    color_hex: input.color_hex ?? null,
    sort_order: nextSort,
    folder_id: input.folder_id ?? null,
  });
  if (varErr) throw new Error(varErr.message);

  const { error: valErr } = await supabase.from("ending_variable_values").insert({
    id: valueId,
    variable_id: variableId,
    value: trimmedValue,
    sort_order: 0,
  });
  if (valErr) throw new Error(valErr.message);

  const { error: defaultErr } = await supabase
    .from("ending_variables")
    .update({ default_value_id: valueId })
    .eq("id", variableId);
  if (defaultErr) throw new Error(defaultErr.message);

  revalidateEndings();
  return { variableId, valueId };
}

/**
 * Create a value with author-supplied text on an existing text variable.
 * Used by the chip pickers' "+ New value…" inline path. Throws on
 * duplicates (server-side uniqueness on `(variable_id, value)`).
 */
export async function createEndingVariableValueInline(input: {
  variable_id: string;
  value: string;
}): Promise<{ valueId: string }> {
  const supabase = await createSupabaseServerClient();
  const trimmedValue = input.value.trim();
  if (!input.variable_id) throw new Error("variable_id is required.");
  if (!trimmedValue) throw new Error("Value text is required.");

  const { data: variable } = await supabase
    .from("ending_variables")
    .select("kind")
    .eq("id", input.variable_id)
    .single();
  if (variable?.kind !== "text") {
    throw new Error("Only text variables accept inline-created values.");
  }

  const { data: existing } = await supabase
    .from("ending_variable_values")
    .select("sort_order")
    .eq("variable_id", input.variable_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const valueId = randomUUID();
  const { error } = await supabase.from("ending_variable_values").insert({
    id: valueId,
    variable_id: input.variable_id,
    value: trimmedValue,
    sort_order: nextSort,
  });
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { valueId };
}

export async function createEndingVariableValue(
  formData: FormData
): Promise<{ id: string; value: string }> {
  const supabase = await createSupabaseServerClient();
  const variable_id = String(formData.get("variable_id") ?? "");
  if (!variable_id) throw new Error("variable_id is required");
  // Optional client-provided id for optimistic UI. If absent, the server
  // mints a fresh uuid (keeps the older FormData callers working).
  const providedId = String(formData.get("id") ?? "");

  // Reject for number_ref variables — they have no stored values, only
  // user-supplied numeric inputs at preview time.
  const { data: variable } = await supabase
    .from("ending_variables")
    .select("kind")
    .eq("id", variable_id)
    .single();
  if (variable?.kind === "number_ref") {
    throw new Error("Number-reference variables don't have stored values.");
  }

  const { data: existing } = await supabase
    .from("ending_variable_values")
    .select("sort_order")
    .eq("variable_id", variable_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const value = await uniqueValueForVariable(supabase, variable_id, "New value");
  const id = providedId || randomUUID();
  const { error } = await supabase
    .from("ending_variable_values")
    .insert({ id, variable_id, value, sort_order: nextSort });
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id, value };
}

/**
 * Escape Postgres ILIKE wildcards (`%`, `_`) and the backslash escape itself
 * so user input is matched literally. Without this, a name like `%foo%`
 * would broaden the uniqueness check across every row containing "foo".
 */
function escapeForLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * Narrow per-field patch — called by useInstantField in VariablesEditor.
 * Does NOT call revalidatePath; realtime fans out the change to other clients.
 * Trims + validates the patched columns; rejects empties and dup names.
 */
export async function patchEndingVariable(
  id: string,
  patch: Partial<{
    name: string;
    default_value_id: string | null;
    sort_order: number;
    color_hex: string | null;
    folder_id: string | null;
  }>
) {
  const supabase = await createSupabaseServerClient();
  const sanitized: typeof patch = { ...patch };

  if (sanitized.name !== undefined) {
    const trimmed = sanitized.name.trim();
    if (!trimmed) throw new Error("Variable name cannot be empty.");
    const { data: conflict } = await supabase
      .from("ending_variables")
      .select("id")
      .ilike("name", escapeForLike(trimmed))
      .neq("id", id)
      .maybeSingle();
    if (conflict) throw new Error(`Duplicate variable name: ${trimmed}`);
    sanitized.name = trimmed;
  }

  if (sanitized.color_hex !== undefined && sanitized.color_hex !== null) {
    const trimmed = sanitized.color_hex.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      throw new Error(`Invalid color "${trimmed}" — expected #RRGGBB.`);
    }
    sanitized.color_hex = trimmed;
  }

  const { error } = await supabase
    .from("ending_variables")
    .update(sanitized)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Narrow per-field patch for a single value row. Trims + enforces non-empty
 * + per-variable value-text uniqueness. No revalidatePath; realtime fans out.
 */
export async function patchEndingVariableValue(
  id: string,
  patch: Partial<{ value: string; sort_order: number }>
) {
  const supabase = await createSupabaseServerClient();
  const sanitized: typeof patch = { ...patch };

  if (sanitized.value !== undefined) {
    const trimmed = sanitized.value.trim();
    if (!trimmed) throw new Error("Value cannot be empty.");
    const { data: existing } = await supabase
      .from("ending_variable_values")
      .select("variable_id")
      .eq("id", id)
      .maybeSingle();
    if (existing) {
      const { data: conflict } = await supabase
        .from("ending_variable_values")
        .select("id")
        .eq("variable_id", existing.variable_id)
        .ilike("value", escapeForLike(trimmed))
        .neq("id", id)
        .maybeSingle();
      if (conflict) throw new Error(`Duplicate value: ${trimmed}`);
    }
    sanitized.value = trimmed;
  }

  const { error } = await supabase
    .from("ending_variable_values")
    .update(sanitized)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteEndingVariable(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase
    .from("ending_variables")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

export async function deleteEndingVariableValue(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase
    .from("ending_variable_values")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

/**
 * Create an empty folder. If `parent_folder_id` is supplied the folder
 * is nested; otherwise it lands at the root. sort_order is auto-assigned
 * to the end of the sibling group so the newest folder appears last.
 */
export async function createEndingVariableFolder(
  input?: { id?: string; parent_folder_id?: string | null }
): Promise<{ id: string }> {
  const result = await createScopedFolder({
    scope: "variable",
    parentFolderId: input?.parent_folder_id ?? null,
    id: input?.id,
  });
  revalidateEndings();
  return result;
}

/**
 * Narrow per-field patch — called by useInstantField in FolderInspector.
 * No revalidatePath; realtime fans out. The DB-side `evf_no_cycle`
 * trigger is the final cycle guard, but a defensive client-side walk
 * happens in moveFolderToFolder for nicer toasts.
 */
export async function patchEndingVariableFolder(
  id: string,
  patch: Partial<{
    name: string;
    parent_folder_id: string | null;
    sort_order: number;
  }>
) {
  await patchScopedFolder({ scope: "variable", id, patch });
}

/**
 * Move a variable into `folder_id` (null = root) at the position before
 * `before_id` (null = end of group). After the move, sort_order for every
 * variable in the destination folder is renumbered 1..N so the local
 * mirror stays in sync without fractional sort_orders.
 */
export async function moveVariableToFolder(input: {
  variable_id: string;
  folder_id: string | null;
  before_id: string | null;
}): Promise<void> {
  await moveScopedVariable({
    variableKind: "text",
    variableId: input.variable_id,
    folderId: input.folder_id,
    beforeId: input.before_id,
  });
  revalidateEndings();
}

/**
 * Move a folder under `parent_folder_id` (null = root) at the position
 * before `before_id`. Server-side cycle check is a friendly backstop —
 * the DB trigger evf_no_cycle is the authoritative wall. Throws on cycle
 * so the client can toast a meaningful message.
 */
export async function moveFolderToFolder(input: {
  folder_id: string;
  parent_folder_id: string | null;
  before_id: string | null;
}): Promise<void> {
  await moveScopedFolder({
    scope: "variable",
    folderId: input.folder_id,
    parentFolderId: input.parent_folder_id,
    beforeId: input.before_id,
  });
  revalidateEndings();
}

/**
 * Delete a folder, reparenting any child folders and contained variables
 * to the folder's own parent (null = root) first. Non-destructive — the
 * DB FK on parent_folder_id is `on delete restrict`, so the reparent must
 * happen before the final delete.
 */
export async function deleteEndingVariableFolder(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteScopedFolder({ scope: "variable", id });
  revalidateEndings();
}
