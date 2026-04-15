"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { IconType } from "@/lib/db/enums";

function nilStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}
function nilNum(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------- Inspection letters ----------------
export async function createInspectionLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const letter_group_id = String(formData.get("letter_group_id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  if (!letter_group_id) return;
  const payload = {
    letter_group_id,
    variant: nilStr(formData.get("variant")),
    piece: nilNum(formData.get("piece")),
    summary: nilStr(formData.get("summary")),
    content: nilStr(formData.get("content")),
  };
  const { data, error } = await supabase
    .from("inspection_letters")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Seed default actions (Deliver + Flag) so the editor isn't empty.
  await supabase.from("actions").insert([
    {
      inspection_letter_id: data!.id,
      name: "Deliver",
      icon_type: "lucide" as IconType,
      icon_value: "Send",
      color_hex: "#4fb07a",
      sort_order: 0,
    },
    {
      inspection_letter_id: data!.id,
      name: "Flag",
      icon_type: "lucide" as IconType,
      icon_value: "Flag",
      color_hex: "#eab308",
      sort_order: 1,
    },
  ]);

  revalidatePath(`/storylines/${storyline_id}/groups/${letter_group_id}`);
}

export async function updateInspectionLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  const letter_group_id = String(formData.get("letter_group_id") ?? "");
  if (!id) return;
  const payload = {
    variant: nilStr(formData.get("variant")),
    piece: nilNum(formData.get("piece")),
    delivery_day_override_id: nilStr(formData.get("delivery_day_override_id")),
    summary: nilStr(formData.get("summary")),
    content: nilStr(formData.get("content")),
    sender_citizen_id: nilStr(formData.get("sender_citizen_id")),
    receiver_citizen_id: nilStr(formData.get("receiver_citizen_id")),
    notes: nilStr(formData.get("notes")),
  };
  const { error } = await supabase
    .from("inspection_letters")
    .update(payload)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/storylines/${storyline_id}/groups/${letter_group_id}`);
}

export async function deleteInspectionLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  const letter_group_id = String(formData.get("letter_group_id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("inspection_letters").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect(`/storylines/${storyline_id}/groups/${letter_group_id}`);
}

// ---------------- Actions ----------------
export async function createAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const inspection_letter_id = String(formData.get("inspection_letter_id") ?? "");
  if (!inspection_letter_id) return;
  const { error } = await supabase.from("actions").insert({
    inspection_letter_id,
    name: String(formData.get("name") ?? "New action"),
    icon_type: "lucide" as IconType,
    icon_value: nilStr(formData.get("icon_value")),
    color_hex: String(formData.get("color_hex") ?? "#888888"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/storylines");
}

export async function updateAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    name: String(formData.get("name") ?? "").trim(),
    icon_type: String(formData.get("icon_type") ?? "lucide") as IconType,
    icon_value: nilStr(formData.get("icon_value")),
    color_hex: String(formData.get("color_hex") ?? "#888888"),
    report_segment_id: nilStr(formData.get("report_segment_id")),
    next_letter_variant: nilStr(formData.get("next_letter_variant")),
    impact_world_status: Number(formData.get("impact_world_status") ?? 0),
    impact_demerits: Number(formData.get("impact_demerits") ?? 0),
    impact_proletariat: Number(formData.get("impact_proletariat") ?? 0),
    impact_gentry: Number(formData.get("impact_gentry") ?? 0),
    impact_epicenter: Number(formData.get("impact_epicenter") ?? 0),
    impact_folos: Number(formData.get("impact_folos") ?? 0),
    impact_emberlyn: Number(formData.get("impact_emberlyn") ?? 0),
    impact_spokgrad: Number(formData.get("impact_spokgrad") ?? 0),
    impact_pelico: Number(formData.get("impact_pelico") ?? 0),
  };
  const { error } = await supabase.from("actions").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/storylines");
}

export async function deleteAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("actions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/storylines");
}

// ---------------- Report segments ----------------
export async function createReportSegment(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const report_group_id = String(formData.get("report_group_id") ?? "");
  const variant = String(formData.get("variant") ?? "").trim();
  if (!report_group_id || !variant) return;
  const { error } = await supabase.from("report_segments").insert({
    report_group_id,
    variant,
    content: nilStr(formData.get("content")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/storylines");
}

export async function updateReportSegment(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    variant: String(formData.get("variant") ?? "").trim(),
    content: nilStr(formData.get("content")),
    delivery_day_override_id: nilStr(formData.get("delivery_day_override_id")),
    sort_order: Number(formData.get("sort_order") ?? 0),
  };
  const { error } = await supabase
    .from("report_segments")
    .update(payload)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/storylines");
}

export async function deleteReportSegment(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("report_segments").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/storylines");
}
