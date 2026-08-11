"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AddressType } from "@/lib/db/enums";

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

async function nextSortId(dayId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("sorting_letters")
    .select("sort_id")
    .eq("day_id", dayId)
    .order("sort_id", { ascending: false })
    .limit(1);
  const highest = data?.[0]?.sort_id ?? -1;
  return highest + 1;
}

export async function createSortingLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  let day_id = String(formData.get("day_id") ?? "");
  if (!day_id) {
    const { data: firstDay } = await supabase
      .from("days")
      .select("id")
      .order("number")
      .limit(1);
    day_id = firstDay?.[0]?.id ?? "";
  }
  if (!day_id) throw new Error("Create a day before adding sorting letters.");
  const sort_id = nilNum(formData.get("sort_id")) ?? (await nextSortId(day_id));

  const { data, error } = await supabase
    .from("sorting_letters")
    .insert({
      day_id,
      sort_id,
      recipient_type: "full" as AddressType,
      sender_type: "full" as AddressType,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/sorting/letters");
  redirect(`/sorting/letters/${data!.id}`);
}

export async function updateSortingLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    day_id: String(formData.get("day_id") ?? ""),
    sort_id: nilNum(formData.get("sort_id")) ?? 0,
    storage_location: nilStr(formData.get("storage_location")),
    stamp_valid: formData.get("stamp_valid") === "on",
    recipient_type: String(formData.get("recipient_type") ?? "full") as AddressType,
    recipient_name: nilStr(formData.get("recipient_name")),
    recipient_citizen_number: nilStr(formData.get("recipient_citizen_number")),
    recipient_city_id: nilStr(formData.get("recipient_city_id")),
    recipient_city_name: nilStr(formData.get("recipient_city_name")),
    recipient_city_code: nilStr(formData.get("recipient_city_code")),
    recipient_nation_id: nilStr(formData.get("recipient_nation_id")),
    sender_type: String(formData.get("sender_type") ?? "full") as AddressType,
    sender_name: nilStr(formData.get("sender_name")),
    sender_citizen_number: nilStr(formData.get("sender_citizen_number")),
    sender_city_id: nilStr(formData.get("sender_city_id")),
    sender_city_name: nilStr(formData.get("sender_city_name")),
    sender_city_code: nilStr(formData.get("sender_city_code")),
    sender_nation_id: nilStr(formData.get("sender_nation_id")),
    notes: nilStr(formData.get("notes")),
  };
  const { error } = await supabase.from("sorting_letters").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/sorting/letters");
  revalidatePath(`/sorting/letters/${id}`);
}

export async function updateAllSortingLetters(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const ids = formData.getAll("ids").map(String);
  const dayIds = formData.getAll("day_ids").map(String);
  const recipientNames = formData.getAll("recipient_names").map(String);
  const senderNames = formData.getAll("sender_names").map(String);
  const storages = formData.getAll("storage_locations").map(String);
  const stamps = formData.getAll("stamp_valids").map(String);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const payload = {
      day_id: dayIds[i] || undefined,
      recipient_name: (recipientNames[i] ?? "").trim() || null,
      sender_name: (senderNames[i] ?? "").trim() || null,
      storage_location: (storages[i] ?? "").trim() || null,
      stamp_valid: stamps[i] === "true",
    };
    if (!payload.day_id) delete (payload as Record<string, unknown>).day_id;
    const { error } = await supabase
      .from("sorting_letters")
      .update(payload)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/sorting/letters");
}

export async function deleteSortingLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  if (updatedBy) {
    await supabase.from("sorting_letters").update({ updated_by: updatedBy }).eq("id", id);
  }
  const { error } = await supabase.from("sorting_letters").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect("/sorting/letters");
}

/**
 * Narrow per-field patch for instant-save. Does NOT call revalidatePath —
 * realtime fans out the change to all subscribed clients.
 */
export async function patchSortingLetter(
  id: string,
  patch: Partial<{
    day_id: string;
    sort_id: number;
    storage_location: string | null;
    stamp_valid: boolean;
    recipient_type: import("@/lib/db/enums").AddressType;
    recipient_name: string | null;
    recipient_citizen_number: string | null;
    recipient_city_id: string | null;
    recipient_city_name: string | null;
    recipient_city_code: string | null;
    recipient_nation_id: string | null;
    sender_type: import("@/lib/db/enums").AddressType;
    sender_name: string | null;
    sender_citizen_number: string | null;
    sender_city_id: string | null;
    sender_city_name: string | null;
    sender_city_code: string | null;
    sender_nation_id: string | null;
    notes: string | null;
  }>
) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sorting_letters")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
