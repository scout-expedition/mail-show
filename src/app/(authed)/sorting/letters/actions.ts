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
  const day_id = String(formData.get("day_id") ?? "");
  if (!day_id) return;
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
    is_counterfeit: formData.get("is_counterfeit") === "on",
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

export async function deleteSortingLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("sorting_letters").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect("/sorting/letters");
}
