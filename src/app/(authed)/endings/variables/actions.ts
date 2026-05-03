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
  table: "ending_variables" | "ending_frameworks",
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

type VariablePayload = {
  id: string;
  name: string;
  default_value_id: string | null;
  sort_order: number;
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

    const { error: varErr } = await supabase
      .from("ending_variables")
      .update({
        name: v.name.trim(),
        default_value_id: v.default_value_id,
        sort_order: v.sort_order,
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
