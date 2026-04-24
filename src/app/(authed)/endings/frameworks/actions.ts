"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function revalidateEndings() {
  revalidatePath("/endings/variables");
  revalidatePath("/endings/logic");
  revalidatePath("/endings/frameworks");
  revalidatePath("/inspection/letters");
}

async function uniqueFrameworkName(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  base: string
): Promise<string> {
  let name = base;
  for (let i = 2; ; i++) {
    const { data } = await supabase
      .from("ending_frameworks")
      .select("id")
      .eq("name", name)
      .maybeSingle();
    if (!data) return name;
    name = `${base} ${i}`;
  }
}

export async function createEndingFramework(): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("ending_frameworks")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const name = await uniqueFrameworkName(supabase, "New framework");
  const { data, error } = await supabase
    .from("ending_frameworks")
    .insert({ name, sort_order: nextSort })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data.id as string };
}

export async function deleteEndingFramework(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase
    .from("ending_frameworks")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

export async function createTextBlock(input: {
  framework_id: string;
  parent_block_id: string | null;
  parent_value_id: string | null;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const nextSort = await nextSiblingSort(
    supabase,
    input.framework_id,
    input.parent_block_id,
    input.parent_value_id
  );
  const { data, error } = await supabase
    .from("ending_framework_blocks")
    .insert({
      framework_id: input.framework_id,
      parent_block_id: input.parent_block_id,
      parent_value_id: input.parent_value_id,
      block_type: "text",
      variable_id: null,
      text: "",
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data.id as string };
}

export async function createConditionBlock(input: {
  framework_id: string;
  parent_block_id: string | null;
  parent_value_id: string | null;
  variable_id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const nextSort = await nextSiblingSort(
    supabase,
    input.framework_id,
    input.parent_block_id,
    input.parent_value_id
  );
  const { data, error } = await supabase
    .from("ending_framework_blocks")
    .insert({
      framework_id: input.framework_id,
      parent_block_id: input.parent_block_id,
      parent_value_id: input.parent_value_id,
      block_type: "condition",
      variable_id: input.variable_id,
      text: "",
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data.id as string };
}

async function nextSiblingSort(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  frameworkId: string,
  parentBlockId: string | null,
  parentValueId: string | null
): Promise<number> {
  let q = supabase
    .from("ending_framework_blocks")
    .select("sort_order")
    .eq("framework_id", frameworkId);
  q = parentBlockId
    ? q.eq("parent_block_id", parentBlockId)
    : q.is("parent_block_id", null);
  q = parentValueId
    ? q.eq("parent_value_id", parentValueId)
    : q.is("parent_value_id", null);
  const { data } = await q
    .order("sort_order", { ascending: false })
    .limit(1);
  return (data?.[0]?.sort_order ?? 0) + 1;
}

/**
 * Change a condition block's variable, purging any descendants along the
 * way since their parent_value_id is tied to the old variable's values.
 * Caller should confirm with the user first when `descendant_count > 0`.
 */
export async function changeConditionBlockVariable(input: {
  block_id: string;
  variable_id: string;
}) {
  const supabase = await createSupabaseServerClient();
  // Collect the full descendant set by BFS.
  const toDelete: string[] = [];
  let frontier = [input.block_id];
  while (frontier.length > 0) {
    const { data } = await supabase
      .from("ending_framework_blocks")
      .select("id")
      .in("parent_block_id", frontier);
    const next = (data ?? []).map((r) => r.id as string);
    toDelete.push(...next);
    frontier = next;
  }
  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("ending_framework_blocks")
      .delete()
      .in("id", toDelete);
    if (delErr) throw new Error(delErr.message);
  }
  const { error } = await supabase
    .from("ending_framework_blocks")
    .update({ variable_id: input.variable_id })
    .eq("id", input.block_id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

export async function deleteBlock(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase
    .from("ending_framework_blocks")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

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
  const { data, error } = await supabase
    .from("ending_variables")
    .insert({ name, sort_order: nextSort })
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

type BlockPayload = {
  id: string;
  parent_block_id: string | null;
  parent_value_id: string | null;
  block_type: "text" | "condition";
  variable_id: string | null;
  text: string;
  sort_order: number;
};

export async function saveFramework(input: {
  id: string;
  name: string;
  blocks: BlockPayload[];
}) {
  const supabase = await createSupabaseServerClient();
  const name = input.name.trim();
  if (!name) throw new Error("Framework name cannot be empty.");

  const { error: fwErr } = await supabase
    .from("ending_frameworks")
    .update({ name })
    .eq("id", input.id);
  if (fwErr) throw new Error(fwErr.message);

  for (const b of input.blocks) {
    const { error } = await supabase
      .from("ending_framework_blocks")
      .update({
        parent_block_id: b.parent_block_id,
        parent_value_id: b.parent_value_id,
        block_type: b.block_type,
        variable_id: b.block_type === "condition" ? b.variable_id : null,
        text: b.block_type === "text" ? b.text : "",
        sort_order: b.sort_order,
      })
      .eq("id", b.id);
    if (error) throw new Error(error.message);
  }

  revalidateEndings();
}
