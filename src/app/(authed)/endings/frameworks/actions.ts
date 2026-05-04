"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { colorIndexFor } from "@/lib/endings/color-palette";
import type { EndingChipOperator } from "@/lib/db/enums";

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
  parent_row_id: string | null;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const nextSort = await nextSiblingSort(
    supabase,
    input.framework_id,
    input.parent_block_id,
    input.parent_row_id
  );
  const { data, error } = await supabase
    .from("ending_framework_blocks")
    .insert({
      framework_id: input.framework_id,
      parent_block_id: input.parent_block_id,
      parent_row_id: input.parent_row_id,
      block_type: "text",
      text: "",
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data.id as string };
}

/**
 * Create an empty condition block and seed exactly one empty row so the
 * authoring surface has something to draw. Variables are derived from the
 * row's chips — there is no chip yet.
 */
export async function createConditionBlock(input: {
  framework_id: string;
  parent_block_id: string | null;
  parent_row_id: string | null;
}): Promise<{ id: string; row_id: string }> {
  const supabase = await createSupabaseServerClient();
  const nextSort = await nextSiblingSort(
    supabase,
    input.framework_id,
    input.parent_block_id,
    input.parent_row_id
  );
  const { data: block, error } = await supabase
    .from("ending_framework_blocks")
    .insert({
      framework_id: input.framework_id,
      parent_block_id: input.parent_block_id,
      parent_row_id: input.parent_row_id,
      block_type: "condition",
      text: "",
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { data: row, error: rowErr } = await supabase
    .from("ending_condition_rows")
    .insert({ condition_block_id: block.id, sort_order: 0 })
    .select("id")
    .single();
  if (rowErr) throw new Error(rowErr.message);

  revalidateEndings();
  return { id: block.id as string, row_id: row.id as string };
}

async function nextSiblingSort(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  frameworkId: string,
  parentBlockId: string | null,
  parentRowId: string | null
): Promise<number> {
  let q = supabase
    .from("ending_framework_blocks")
    .select("sort_order")
    .eq("framework_id", frameworkId);
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

// --- Rows ----------------------------------------------------------------

export async function addRow(input: {
  condition_block_id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("ending_condition_rows")
    .select("sort_order")
    .eq("condition_block_id", input.condition_block_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const { data, error } = await supabase
    .from("ending_condition_rows")
    .insert({
      condition_block_id: input.condition_block_id,
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data.id as string };
}

export async function removeRow(formData: FormData) {
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
  condition_block_id: string;
  variable_id: string;
}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("ending_condition_block_variables")
    .select("sort_order")
    .eq("condition_block_id", input.condition_block_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? -1) + 1;
  // The unique (condition_block_id, variable_id) constraint makes this
  // idempotent: adding a variable that's already declared is a no-op.
  const { data, error } = await supabase
    .from("ending_condition_block_variables")
    .upsert(
      {
        condition_block_id: input.condition_block_id,
        variable_id: input.variable_id,
        sort_order: nextSort,
      },
      { onConflict: "condition_block_id,variable_id", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw new Error(error.message);
  // upsert with ignoreDuplicates returns [] when the row already existed.
  // Fetch the existing id in that case so callers always get one.
  if (!data || data.length === 0) {
    const { data: existing } = await supabase
      .from("ending_condition_block_variables")
      .select("id")
      .eq("condition_block_id", input.condition_block_id)
      .eq("variable_id", input.variable_id)
      .single();
    if (!existing) throw new Error("addBlockVariable: row missing post-upsert");
    revalidateEndings();
    return { id: existing.id as string };
  }
  revalidateEndings();
  return { id: data[0].id as string };
}

export async function removeBlockVariable(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Look up the (block_id, variable_id) pair so we can also delete chips
  // that reference this variable on any row in the block. The
  // ending_condition_block_variables FK cascades on the block-level
  // table only — chips need an explicit purge.
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

// --- Chips ---------------------------------------------------------------

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
  // Ensure the chip's variable is declared on the parent block's header
  // (Phase 6). If a row's chip references a variable that isn't yet
  // in the header — e.g. via legacy authoring flows — auto-add it so
  // the header stays the source of truth for "what this block branches
  // on".
  const { data: row } = await supabase
    .from("ending_condition_rows")
    .select("condition_block_id")
    .eq("id", input.row_id)
    .single();
  if (row) {
    await addBlockVariable({
      condition_block_id: row.condition_block_id as string,
      variable_id: input.variable_id,
    });
  }
  revalidateEndings();
  return { id: data.id as string };
}

export async function removeChip(formData: FormData) {
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

// --- Inline variable + value creation ------------------------------------

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
  // Pre-generate the id so the deterministic color hash is anchored to the
  // identity we know we're about to insert.
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

// --- saveFramework: UPDATE-only across blocks + rows + chips -------------

type BlockPayload = {
  id: string;
  parent_block_id: string | null;
  parent_row_id: string | null;
  block_type: "text" | "condition";
  text: string;
  sort_order: number;
};

type RowPayload = {
  id: string;
  condition_block_id: string;
  sort_order: number;
};

type ChipPayload = {
  id: string;
  row_id: string;
  variable_id: string;
  operator: EndingChipOperator;
  text_value_id: string | null;
  number_value: number | null;
  aggregate_value: string | null;
  sort_order: number;
};

type BlockVariablePayload = {
  id: string;
  sort_order: number;
};

export async function saveFramework(input: {
  id: string;
  name: string;
  blocks: BlockPayload[];
  rows: RowPayload[];
  chips: ChipPayload[];
  blockVariables?: BlockVariablePayload[];
}) {
  const supabase = await createSupabaseServerClient();
  const name = input.name.trim();
  if (!name) throw new Error("Framework name cannot be empty.");

  const { error: fwErr } = await supabase
    .from("ending_frameworks")
    .update({ name })
    .eq("id", input.id);
  if (fwErr) throw new Error(fwErr.message);

  // Three batches of UPDATEs in parallel — no inserts, no deletes.
  const blockUpdates = input.blocks.map(async (b) => {
    const { error } = await supabase
      .from("ending_framework_blocks")
      .update({
        parent_block_id: b.parent_block_id,
        parent_row_id: b.parent_row_id,
        block_type: b.block_type,
        text: b.block_type === "text" ? b.text : "",
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

  const blockVariableUpdates = (input.blockVariables ?? []).map(async (bv) => {
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
    ...blockVariableUpdates,
  ]);

  revalidateEndings();
}
