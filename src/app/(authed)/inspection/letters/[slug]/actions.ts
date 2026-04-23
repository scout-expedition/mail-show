"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CitizenType, IconType } from "@/lib/db/enums";

/**
 * Reassign variants for every letter in a group based on current sort_order.
 * One letter → variant = null. Multiple → a, b, c... in sort_order.
 */
async function reassignVariants(groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("inspection_letters")
    .select("id, sort_order")
    .eq("letter_group_id", groupId)
    .order("sort_order");
  const list = rows ?? [];
  if (list.length === 0) return;
  if (list.length === 1) {
    await supabase
      .from("inspection_letters")
      .update({ variant: null })
      .eq("id", list[0].id as string);
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const variant = String.fromCharCode(97 + i);
    await supabase
      .from("inspection_letters")
      .update({ variant })
      .eq("id", list[i].id as string);
  }
}

type LetterPatch = {
  id: string;
  piece: number | null;
  delivery_day_override_id: string | null;
  summary: string | null;
  content: string | null;
  sender_citizen_id: string | null;
  receiver_citizen_id: string | null;
  notes: string | null;
};

type ActionPatch = {
  id: string;
  report_segment_id: string | null;
  next_letter_variant: string | null;
  impact_world_status: number;
  impact_demerits: number;
  impact_proletariat: number;
  impact_gentry: number;
  impact_epicenter: number;
  impact_folos: number;
  impact_emberlyn: number;
  impact_spokgrad: number;
  impact_pelico: number;
};

export async function saveGroup(data: {
  id: string;
  storyline_id: string;
  name: string;
  notes: string | null;
  delivery_day_id: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const { id, ...rest } = data;
  const { error } = await supabase
    .from("letter_groups")
    .update(rest)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await supabase
    .from("report_groups")
    .update({ name: rest.name })
    .eq("letter_group_id", id);
  revalidatePath("/inspection/letters/[slug]", "page");
  revalidatePath("/inspection/letters");
}

export async function deleteGroup(groupId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("letter_groups")
    .delete()
    .eq("id", groupId);
  if (error) throw new Error(error.message);
  redirect("/inspection/letters");
}

export async function createInspectionLetterInGroup(groupId: string) {
  const ids = await createInspectionLettersInGroup(groupId, 1);
  return ids[0];
}

/**
 * Create 1..3 letters in a group. When count > 1, variants are assigned the
 * next available lowercase letters (a-z) that are not already used in the
 * group; the first created letter gets the first free letter, etc.
 */
export async function createInspectionLettersInGroup(
  groupId: string,
  count: number
) {
  const supabase = await createSupabaseServerClient();
  const n = Math.max(1, Math.min(3, count));
  const { data: existing } = await supabase
    .from("inspection_letters")
    .select("sort_order")
    .eq("letter_group_id", groupId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextStart = (existing?.[0]?.sort_order ?? 0) + 1;
  const toInsert = Array.from({ length: n }, (_, i) => ({
    letter_group_id: groupId,
    sort_order: nextStart + i,
  }));
  const { data, error } = await supabase
    .from("inspection_letters")
    .insert(toInsert)
    .select("id");
  if (error) throw new Error(error.message);
  await reassignVariants(groupId);
  revalidatePath("/inspection/letters/[slug]", "page");
  return (data ?? []).map((r) => r.id as string);
}

export async function deleteInspectionLetter(groupId: string, letterId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inspection_letters")
    .delete()
    .eq("id", letterId);
  if (error) throw new Error(error.message);
  await reassignVariants(groupId);
  revalidatePath("/inspection/letters/[slug]", "page");
}

/** Reorder letters by passing the new order of letter ids. */
export async function reorderInspectionLetters(
  groupId: string,
  orderedIds: string[]
) {
  const supabase = await createSupabaseServerClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("inspection_letters")
      .update({ sort_order: i + 1 })
      .eq("id", orderedIds[i]);
    if (error) throw new Error(error.message);
  }
  await reassignVariants(groupId);
  revalidatePath("/inspection/letters/[slug]", "page");
  revalidatePath("/inspection/letters");
}

/** Reorder letter groups within a storyline by passing the new order of group ids. */
export async function reorderLetterGroups(
  storylineId: string,
  orderedIds: string[]
) {
  const supabase = await createSupabaseServerClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("letter_groups")
      .update({ sequence: i + 1 })
      .eq("id", orderedIds[i])
      .eq("storyline_id", storylineId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/inspection/letters");
  revalidatePath(`/inspection/storylines/${storylineId}`);
}

export async function saveLetterWithActions(
  groupId: string,
  letter: LetterPatch,
  actions: ActionPatch[]
) {
  const supabase = await createSupabaseServerClient();
  const { id: letterId, ...letterRest } = letter;
  const { error: lErr } = await supabase
    .from("inspection_letters")
    .update(letterRest)
    .eq("id", letterId);
  if (lErr) throw new Error(lErr.message);
  for (const a of actions) {
    const { id: actionId, ...rest } = a;
    const { error } = await supabase
      .from("actions")
      .update(rest)
      .eq("id", actionId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/inspection/letters/[slug]", "page");
}

export async function addActionFromTemplate(
  groupId: string,
  letterId: string,
  templateId: string
) {
  const supabase = await createSupabaseServerClient();
  const { data: tpl, error: tErr } = await supabase
    .from("action_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!tpl) throw new Error("Template not found");

  const templatesToInsert: Array<{ id: string; tpl: typeof tpl }> = [
    { id: tpl.id, tpl },
  ];
  if (tpl.paired_template_id) {
    const { data: partner } = await supabase
      .from("action_templates")
      .select("*")
      .eq("id", tpl.paired_template_id)
      .maybeSingle();
    if (partner) templatesToInsert.push({ id: partner.id, tpl: partner });
  }

  const { data: existing } = await supabase
    .from("actions")
    .select("sort_order")
    .eq("inspection_letter_id", letterId)
    .order("sort_order", { ascending: false })
    .limit(1);
  let nextSort = (existing?.[0]?.sort_order ?? -1) + 1;

  const rows = templatesToInsert.map(({ tpl: t }) => ({
    inspection_letter_id: letterId,
    action_template_id: t.id,
    name: t.name,
    icon_type: t.icon_type as IconType,
    icon_value: t.icon_value,
    color_hex: t.color_hex,
    sort_order: nextSort++,
  }));
  const { error } = await supabase.from("actions").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters/[slug]", "page");
}

export async function deleteActionRow(groupId: string, actionId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("actions").delete().eq("id", actionId);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters/[slug]", "page");
}

/** Ensure the given letter has a non-null variant so it can be referenced. */
async function ensureLetterVariant(letterId: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: row } = await supabase
    .from("inspection_letters")
    .select("variant")
    .eq("id", letterId)
    .maybeSingle();
  const existing = (row?.variant ?? null) as string | null;
  if (existing) return existing;
  await supabase
    .from("inspection_letters")
    .update({ variant: "a" })
    .eq("id", letterId);
  return "a";
}

/**
 * Create a new letter in the "next" letter group (by sequence) in the same
 * storyline. Returns the new letter's variant so the caller can set it as
 * `next_letter_variant` on the current action.
 */
export async function createLetterInNextGroup(
  currentGroupId: string
): Promise<{ letterId: string; variant: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: cur } = await supabase
    .from("letter_groups")
    .select("id, storyline_id, sequence")
    .eq("id", currentGroupId)
    .maybeSingle();
  if (!cur) throw new Error("Current letter group not found");
  const { data: next } = await supabase
    .from("letter_groups")
    .select("id")
    .eq("storyline_id", cur.storyline_id)
    .gt("sequence", cur.sequence)
    .order("sequence")
    .limit(1);
  const nextGroupId = next?.[0]?.id as string | undefined;
  if (!nextGroupId) throw new Error("No next letter group exists");
  const ids = await createInspectionLettersInGroup(nextGroupId, 1);
  const letterId = ids[0];
  const variant = await ensureLetterVariant(letterId);
  revalidatePath("/inspection/letters/[slug]", "page");
  return { letterId, variant };
}

/**
 * Create the next letter group (auto sequence) and a first letter in it.
 * Returns the new letter's variant for the action linkage.
 */
export async function createNextLetterGroupAndLetter(
  currentGroupId: string
): Promise<{ newGroupId: string; letterId: string; variant: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: cur } = await supabase
    .from("letter_groups")
    .select("id, storyline_id, sequence")
    .eq("id", currentGroupId)
    .maybeSingle();
  if (!cur) throw new Error("Current letter group not found");
  const { data: existing } = await supabase
    .from("letter_groups")
    .select("sequence")
    .eq("storyline_id", cur.storyline_id)
    .order("sequence", { ascending: false })
    .limit(1);
  const nextSeq = (existing?.[0]?.sequence ?? 0) + 1;
  const { data: newGroup, error } = await supabase
    .from("letter_groups")
    .insert({
      storyline_id: cur.storyline_id,
      name: `Group ${nextSeq}`,
      sequence: nextSeq,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const newGroupId = newGroup!.id as string;
  const ids = await createInspectionLettersInGroup(newGroupId, 1);
  const letterId = ids[0];
  const variant = await ensureLetterVariant(letterId);
  revalidatePath("/inspection/letters/[slug]", "page");
  revalidatePath("/inspection/letters");
  return { newGroupId, letterId, variant };
}

export async function saveReportSegment(data: {
  id: string;
  variant: string;
  content: string | null;
  delivery_day_override_id: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  const { id, ...rest } = data;
  const { error } = await supabase
    .from("report_segments")
    .update(rest)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters/[slug]", "page");
}

/**
 * Create a new report segment in the given letter group's report_group.
 * Returns the new segment's id for the action linkage.
 */
export async function createReportSegmentForGroup(
  groupId: string
): Promise<{ segmentId: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: rg } = await supabase
    .from("report_groups")
    .select("id")
    .eq("letter_group_id", groupId)
    .maybeSingle();
  if (!rg) throw new Error("Report group missing");
  const { data: existing } = await supabase
    .from("report_segments")
    .select("sort_order")
    .eq("report_group_id", rg.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  // Variant is a roman numeral — use the next sequential one.
  const roman = (n: number): string => {
    const m = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
    return m[n - 1] ?? String(n);
  };
  const { data: inserted, error } = await supabase
    .from("report_segments")
    .insert({
      report_group_id: rg.id,
      variant: roman(nextSort),
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/letters/[slug]", "page");
  return { segmentId: inserted!.id as string };
}

export async function quickCreateCitizen(data: {
  name: string;
  type: CitizenType;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: row, error } = await supabase
    .from("citizens")
    .insert({ name: data.name.trim(), type: data.type })
    .select("id, name, type")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
  return row;
}
