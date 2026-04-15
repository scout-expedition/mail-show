"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { IconType } from "@/lib/db/enums";

function nilStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function createStoryline(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const name = String(formData.get("name") ?? "").trim();
  const abbreviation = String(formData.get("abbreviation") ?? "").trim();
  if (!name || !abbreviation) return;
  const payload = {
    name,
    abbreviation: abbreviation.toUpperCase().charAt(0),
    description: nilStr(formData.get("description")),
    icon_type: (String(formData.get("icon_type") ?? "lucide") as IconType) || "lucide",
    icon_value: nilStr(formData.get("icon_value")),
    color_hex: String(formData.get("color_hex") ?? "#888888"),
  };
  const { data, error } = await supabase
    .from("storylines")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/storylines");
  redirect(`/storylines/${data!.id}`);
}

export async function updateStoryline(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    name: String(formData.get("name") ?? "").trim(),
    abbreviation: String(formData.get("abbreviation") ?? "")
      .trim()
      .toUpperCase()
      .charAt(0),
    description: nilStr(formData.get("description")),
    icon_type: String(formData.get("icon_type") ?? "lucide") as IconType,
    icon_value: nilStr(formData.get("icon_value")),
    color_hex: String(formData.get("color_hex") ?? "#888888"),
    sort_order: Number(formData.get("sort_order") ?? 0),
  };
  const { error } = await supabase.from("storylines").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/storylines/${id}`);
  revalidatePath("/storylines");
}

export async function deleteStoryline(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("storylines").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect("/storylines");
}

export async function createLetterGroup(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const storyline_id = String(formData.get("storyline_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const sequence = Number(formData.get("sequence") ?? 0);
  if (!storyline_id || !name) return;
  const delivery_day_id = nilStr(formData.get("delivery_day_id"));
  const { data, error } = await supabase
    .from("letter_groups")
    .insert({ storyline_id, name, sequence, delivery_day_id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/storylines/${storyline_id}`);
  redirect(`/storylines/${storyline_id}/groups/${data!.id}`);
}

export async function updateLetterGroup(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  if (!id) return;
  const payload = {
    name: String(formData.get("name") ?? "").trim(),
    notes: nilStr(formData.get("notes")),
    sequence: Number(formData.get("sequence") ?? 0),
    delivery_day_id: nilStr(formData.get("delivery_day_id")),
  };
  const { error } = await supabase.from("letter_groups").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  // Also mirror the name onto the linked report group (keeps them in sync by default).
  await supabase
    .from("report_groups")
    .update({ name: payload.name })
    .eq("letter_group_id", id);
  revalidatePath(`/storylines/${storyline_id}/groups/${id}`);
  revalidatePath(`/storylines/${storyline_id}`);
}

export async function deleteLetterGroup(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("letter_groups").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect(`/storylines/${storyline_id}`);
}
