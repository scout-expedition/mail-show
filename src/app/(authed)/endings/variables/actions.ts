"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { colorIndexFor } from "@/lib/endings/color-palette";
import type { EndingVariableKind } from "@/lib/db/enums";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";

const NUMBER_REF_COLUMNS = Object.keys(VARIABLE_LABELS) as Array<
  keyof typeof VARIABLE_LABELS
>;
const NUMBER_REF_SET = new Set<string>(NUMBER_REF_COLUMNS);

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
 * Create a variable. Accepts an optional FormData with:
 *   - kind: 'text' (default) or 'number_ref'
 *   - number_ref: required when kind='number_ref'; one of the 10 impact columns
 */
export async function createEndingVariable(formData?: FormData) {
  const supabase = await createSupabaseServerClient();
  const rawKind = formData ? String(formData.get("kind") ?? "text") : "text";
  if (rawKind !== "text" && rawKind !== "number_ref") {
    throw new Error(`createEndingVariable: invalid kind "${rawKind}"`);
  }
  const kind: EndingVariableKind = rawKind;
  let numberRef: string | null = null;
  if (kind === "number_ref") {
    const ref = formData ? String(formData.get("number_ref") ?? "") : "";
    if (!NUMBER_REF_SET.has(ref)) {
      throw new Error(
        `createEndingVariable: number_ref must be one of ${NUMBER_REF_COLUMNS.join(", ")}`
      );
    }
    numberRef = ref;
  }

  const { data: existing } = await supabase
    .from("ending_variables")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const baseName =
    kind === "number_ref"
      ? VARIABLE_LABELS[numberRef as keyof typeof VARIABLE_LABELS]
      : "New variable";
  const name = await uniqueName(supabase, "ending_variables", baseName);
  const id = randomUUID();
  const { error } = await supabase.from("ending_variables").insert({
    id,
    name,
    kind,
    number_ref: numberRef,
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
