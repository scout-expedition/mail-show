"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AddressType } from "@/lib/db/enums";

/** Paths that show a sorting letter's ID or day and so go stale when one is
 *  created, moved, or deleted. Field edits only touch the letters page. */
export function revalidateSortingLetterSurfaces() {
  revalidatePath("/sorting/letters");
  revalidatePath("/physical");
  revalidatePath("/days/[identifier]/sorting", "page");
}

/**
 * The lowest unused sort_id on a day. Letters are numbered 0–99 per day and
 * the pair is unique, so a gap left by a deletion is reused before the tail
 * grows — that is what "lowest open ID" means everywhere in this feature.
 */
export async function lowestFreeSortId(dayId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("sorting_letters")
    .select("sort_id")
    .eq("day_id", dayId)
    .order("sort_id");
  const taken = new Set((data ?? []).map((r) => r.sort_id as number));
  for (let i = 0; i <= 99; i++) {
    if (!taken.has(i)) return i;
  }
  throw new Error("That day already holds 100 sorting letters (IDs 0–99).");
}

export async function createSortingLetter({
  dayId,
}: {
  dayId?: string | null;
} = {}): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  let day_id = dayId ?? "";
  if (!day_id) {
    const { data: firstDay } = await supabase
      .from("days")
      .select("id")
      .order("number")
      .limit(1);
    day_id = firstDay?.[0]?.id ?? "";
  }
  if (!day_id) throw new Error("Create a day before adding sorting letters.");
  const sort_id = await lowestFreeSortId(day_id);

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
  revalidateSortingLetterSurfaces();
  return { id: data!.id as string };
}

export async function deleteSortingLetter(id: string) {
  if (!id) return;
  const supabase = await createSupabaseServerClient();
  // Stamp the deleter first: the DELETE payload realtime broadcasts carries
  // the prior row, which is how peers learn who removed the letter.
  const { data: userData } = await supabase.auth.getUser();
  const updatedBy = userData.user?.email ?? null;
  if (updatedBy) {
    await supabase.from("sorting_letters").update({ updated_by: updatedBy }).eq("id", id);
  }
  const { error } = await supabase.from("sorting_letters").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateSortingLetterSurfaces();
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
