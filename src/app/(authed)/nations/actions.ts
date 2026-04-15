"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createNation(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const name = String(formData.get("name") ?? "").trim();
  const abbreviation = String(formData.get("abbreviation") ?? "").trim() || null;
  const color_hex = String(formData.get("color_hex") ?? "#888888").trim();
  if (!name) return;
  const { error } = await supabase
    .from("nations")
    .insert({ name, abbreviation, color_hex });
  if (error) throw new Error(error.message);
  revalidatePath("/nations");
}

export async function updateNation(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const abbreviation = String(formData.get("abbreviation") ?? "").trim() || null;
  const color_hex = String(formData.get("color_hex") ?? "#888888").trim();
  const sort_order = Number(formData.get("sort_order") ?? 0);
  if (!id || !name) return;
  const { error } = await supabase
    .from("nations")
    .update({ name, abbreviation, color_hex, sort_order })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/nations");
}

export async function deleteNation(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("nations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/nations");
}
