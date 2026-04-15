"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CitizenType } from "@/lib/db/enums";

function nilOrString(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function createCitizen(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const payload = {
    name,
    type: (String(formData.get("type") ?? "npc") as CitizenType) || "npc",
    citizen_id: nilOrString(formData.get("citizen_id")),
    nation_id: nilOrString(formData.get("nation_id")),
    city_id: nilOrString(formData.get("city_id")),
    notes: nilOrString(formData.get("notes")),
  };
  const { error } = await supabase.from("citizens").insert(payload);
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
}

export async function updateCitizen(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    name: String(formData.get("name") ?? "").trim(),
    type: String(formData.get("type") ?? "npc") as CitizenType,
    citizen_id: nilOrString(formData.get("citizen_id")),
    nation_id: nilOrString(formData.get("nation_id")),
    city_id: nilOrString(formData.get("city_id")),
    notes: nilOrString(formData.get("notes")),
  };
  const { error } = await supabase.from("citizens").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
}

export async function deleteCitizen(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("citizens").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/citizens");
}
