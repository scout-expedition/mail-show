"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Phase } from "@/lib/db/enums";
import * as mutations from "@/lib/playthroughs/mutations";

function nilStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function createPlaythrough() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("playthroughs")
    .insert({ name: "New playthrough", current_phase: "top_of_day" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/playthroughs");
  redirect(`/playthroughs/${data!.id}`);
}

export async function updatePlaythrough(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    name: String(formData.get("name") ?? "").trim(),
    notes: nilStr(formData.get("notes")),
    current_day_id: nilStr(formData.get("current_day_id")),
    current_phase: String(formData.get("current_phase") ?? "top_of_day") as Phase,
  };
  const { error } = await supabase
    .from("playthroughs")
    .update(payload)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/playthroughs/${id}`);
}

export async function setActivePlaythrough(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Only one active at a time.
  await supabase
    .from("playthroughs")
    .update({ is_active: false })
    .neq("id", id);
  const { error } = await supabase
    .from("playthroughs")
    .update({ is_active: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/playthroughs");
  revalidatePath("/");
}

export async function clearActivePlaythrough() {
  const supabase = await createSupabaseServerClient();
  await supabase.from("playthroughs").update({ is_active: false });
  revalidatePath("/playthroughs");
  revalidatePath("/");
}

export async function deletePlaythrough(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("playthroughs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect("/playthroughs");
}

export async function chooseAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const playthrough_id = String(formData.get("playthrough_id") ?? "");
  const inspection_letter_id = String(formData.get("inspection_letter_id") ?? "");
  const chosen_action_id = String(formData.get("chosen_action_id") ?? "");
  if (!playthrough_id || !inspection_letter_id || !chosen_action_id) return;
  await mutations.chooseAction(supabase, {
    playthroughId: playthrough_id,
    inspectionLetterId: inspection_letter_id,
    chosenActionId: chosen_action_id,
  });
  revalidatePath(`/playthroughs/${playthrough_id}`);
  revalidatePath("/");
}

export async function clearChoice(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const playthrough_id = String(formData.get("playthrough_id") ?? "");
  const inspection_letter_id = String(formData.get("inspection_letter_id") ?? "");
  await mutations.clearChoice(supabase, {
    playthroughId: playthrough_id,
    inspectionLetterId: inspection_letter_id,
  });
  revalidatePath(`/playthroughs/${playthrough_id}`);
}
