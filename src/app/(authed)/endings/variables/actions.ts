"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { colorIndexFor } from "@/lib/endings/color-palette";

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
export async function createEndingVariable() {
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
  const id = randomUUID();
  const { error } = await supabase.from("ending_variables").insert({
    id,
    name,
    kind: "text",
    number_ref: null,
    color_index: colorIndexFor(id),
    sort_order: nextSort,
  });
  if (error) throw new Error(error.message);
  revalidateEndings();
}

/**
 * Create a text variable + a single value in one round-trip, used by the
 * "+ New variable…" inline path in the frameworks chip pickers. Returns
 * the ids so the caller can immediately reference them.
 */
export async function createEndingVariableInline(input: {
  name: string;
  firstValue: string;
}): Promise<{ variableId: string; valueId: string }> {
  const supabase = await createSupabaseServerClient();
  const trimmedName = input.name.trim();
  const trimmedValue = input.firstValue.trim();
  if (!trimmedName) throw new Error("Variable name is required.");
  if (!trimmedValue) throw new Error("First value is required.");

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
    sort_order: nextSort,
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

export async function createEndingVariableValue(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const variable_id = String(formData.get("variable_id") ?? "");
  if (!variable_id) throw new Error("variable_id is required");

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
  const { error } = await supabase
    .from("ending_variable_values")
    .insert({ variable_id, value, sort_order: nextSort });
  if (error) throw new Error(error.message);
  revalidateEndings();
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
      .ilike("name", trimmed)
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
        .ilike("value", trimmed)
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

type VariablePayload = {
  id: string;
  name: string;
  default_value_id: string | null;
  sort_order: number;
  color_hex: string | null;
  values: Array<{ id: string; value: string; sort_order: number }>;
};

export async function updateAllEndingVariables(payload: VariablePayload[]) {
  const supabase = await createSupabaseServerClient();

  // Name uniqueness guard across the submitted rows.
  const seenNames = new Set<string>();
  for (const v of payload) {
    const n = v.name.trim();
    if (!n) throw new Error("Variable name cannot be empty.");
    const k = n.toLowerCase();
    if (seenNames.has(k)) throw new Error(`Duplicate variable name: ${n}`);
    seenNames.add(k);
  }

  for (const v of payload) {
    // Value-text uniqueness guard per variable.
    const seenValues = new Set<string>();
    for (const val of v.values) {
      const t = val.value.trim();
      if (!t) throw new Error(`Value for "${v.name}" cannot be empty.`);
      const k = t.toLowerCase();
      if (seenValues.has(k))
        throw new Error(`Duplicate value "${t}" in variable "${v.name}".`);
      seenValues.add(k);
    }

    // Update values first so default_value_id has something to point at.
    for (const val of v.values) {
      const { error } = await supabase
        .from("ending_variable_values")
        .update({ value: val.value.trim(), sort_order: val.sort_order })
        .eq("id", val.id);
      if (error) throw new Error(error.message);
    }

    const trimmedHex = v.color_hex?.trim() ?? null;
    if (trimmedHex && !/^#[0-9a-fA-F]{6}$/.test(trimmedHex)) {
      throw new Error(`Invalid color "${trimmedHex}" — expected #RRGGBB.`);
    }
    const { error: varErr } = await supabase
      .from("ending_variables")
      .update({
        name: v.name.trim(),
        default_value_id: v.default_value_id,
        sort_order: v.sort_order,
        color_hex: trimmedHex,
      })
      .eq("id", v.id);
    if (varErr) throw new Error(varErr.message);
  }
  revalidateEndings();
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
