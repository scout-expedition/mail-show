"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ContentRefType } from "@/lib/db/enums";
import { randomLetterId } from "@/lib/ids";

function nilStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function createPhysicalLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const content_ref_type = String(formData.get("content_ref_type") ?? "sorting") as ContentRefType;
  const content_ref_id = String(formData.get("content_ref_id") ?? "");
  if (!content_ref_id) return;

  // Generate a unique 6-digit letter_id (retry a few times).
  for (let attempt = 0; attempt < 6; attempt++) {
    const letter_id = randomLetterId();
    const { error } = await supabase.from("physical_letters").insert({
      letter_id,
      content_ref_type,
      content_ref_id,
      storage_location: nilStr(formData.get("storage_location")),
      notes: nilStr(formData.get("notes")),
    });
    if (!error) break;
    if (!/unique/i.test(error.message)) {
      throw new Error(error.message);
    }
  }
  revalidatePath("/physical");
}

export async function updatePhysicalLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    storage_location: nilStr(formData.get("storage_location")),
    notes: nilStr(formData.get("notes")),
  };
  const { error } = await supabase.from("physical_letters").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/physical");
}

export async function deletePhysicalLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("physical_letters").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/physical");
}
