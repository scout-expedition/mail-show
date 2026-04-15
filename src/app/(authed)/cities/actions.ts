"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createCity(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const nation_id = String(formData.get("nation_id") ?? "").trim();
  if (!name || !code || !nation_id) return;
  const { error } = await supabase.from("cities").insert({ name, code, nation_id });
  if (error) throw new Error(error.message);
  revalidatePath("/cities");
}

export async function updateCity(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const nation_id = String(formData.get("nation_id") ?? "").trim();
  if (!id || !name || !code || !nation_id) return;
  const { error } = await supabase
    .from("cities")
    .update({ name, code, nation_id })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/cities");
}

export async function deleteCity(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("cities").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/cities");
}
