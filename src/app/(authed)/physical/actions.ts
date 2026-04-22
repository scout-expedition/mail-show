"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ContentRefType } from "@/lib/db/enums";
import { randomLetterId } from "@/lib/ids";

function nilStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function createPhysicalLetter() {
  const supabase = await createSupabaseServerClient();
  // Default to the first available sorting letter, else the first inspection letter.
  let content_ref_type: ContentRefType = "sorting";
  const { data: sortingRef } = await supabase
    .from("sorting_letters_view")
    .select("id")
    .order("content_id")
    .limit(1);
  let content_ref_id = sortingRef?.[0]?.id ?? "";
  if (!content_ref_id) {
    const { data: inspRef } = await supabase
      .from("inspection_letters_view")
      .select("id")
      .order("content_id")
      .limit(1);
    content_ref_id = inspRef?.[0]?.id ?? "";
    content_ref_type = "inspection";
  }
  if (!content_ref_id)
    throw new Error(
      "Create a sorting or inspection letter before adding physical letters."
    );

  for (let attempt = 0; attempt < 6; attempt++) {
    const letter_id = randomLetterId();
    const { error } = await supabase.from("physical_letters").insert({
      letter_id,
      content_ref_type,
      content_ref_id,
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

export async function updateAllPhysicalLetters(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const ids = formData.getAll("ids").map(String);
  const storages = formData.getAll("storage_locations").map(String);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const { error } = await supabase
      .from("physical_letters")
      .update({ storage_location: (storages[i] ?? "").trim() || null })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
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
