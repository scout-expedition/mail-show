"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CitizenType, IconType } from "@/lib/db/enums";

function normalizeVariant(v: string | null): string | null {
  if (v === null) return null;
  const cleaned = v.trim().toLowerCase().slice(0, 1);
  return /^[a-z]$/.test(cleaned) ? cleaned : null;
}

type LetterPatch = {
  id: string;
  variant: string | null;
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
  sequence: number;
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
  revalidatePath(`/inspection/letters/${id}`);
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
    .select("variant")
    .eq("letter_group_id", groupId);
  const used = new Set(
    (existing ?? [])
      .map((r) => (r.variant ?? "").toLowerCase())
      .filter((v) => v.length === 1)
  );
  const toInsert: Array<{ letter_group_id: string; variant: string | null }> = [];
  if (n === 1) {
    toInsert.push({ letter_group_id: groupId, variant: null });
  } else {
    for (let c = 97; c <= 122 && toInsert.length < n; c++) {
      const ch = String.fromCharCode(c);
      if (!used.has(ch)) {
        toInsert.push({ letter_group_id: groupId, variant: ch });
        used.add(ch);
      }
    }
  }
  const { data, error } = await supabase
    .from("inspection_letters")
    .insert(toInsert)
    .select("id");
  if (error) throw new Error(error.message);
  revalidatePath(`/inspection/letters/${groupId}`);
  return (data ?? []).map((r) => r.id as string);
}

export async function deleteInspectionLetter(groupId: string, letterId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inspection_letters")
    .delete()
    .eq("id", letterId);
  if (error) throw new Error(error.message);
  revalidatePath(`/inspection/letters/${groupId}`);
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
    .update({ ...letterRest, variant: normalizeVariant(letterRest.variant) })
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
  revalidatePath(`/inspection/letters/${groupId}`);
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
  const { data: existing } = await supabase
    .from("actions")
    .select("sort_order")
    .eq("inspection_letter_id", letterId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? -1) + 1;
  const { error } = await supabase.from("actions").insert({
    inspection_letter_id: letterId,
    action_template_id: tpl.id,
    name: tpl.name,
    icon_type: tpl.icon_type as IconType,
    icon_value: tpl.icon_value,
    color_hex: tpl.color_hex,
    sort_order: nextSort,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/inspection/letters/${groupId}`);
}

export async function deleteActionRow(groupId: string, actionId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("actions").delete().eq("id", actionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/inspection/letters/${groupId}`);
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
