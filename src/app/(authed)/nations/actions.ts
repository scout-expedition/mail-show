"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeHex } from "@/lib/color";
import type { IconType } from "@/lib/db/enums";

export async function createNation() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("nations")
    .insert({ name: "New nation", color_hex: "#888888" });
  if (error) throw new Error(error.message);
  revalidatePath("/nations");
}

export async function updateAllNations(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const ids = formData.getAll("ids").map(String);
  const names = formData.getAll("names").map(String);
  const abbreviations = formData.getAll("abbreviations").map(String);
  const colors = formData.getAll("colors").map(String);
  const iconTypes = formData.getAll("icon_types").map(String);
  const iconValues = formData.getAll("icon_values").map(String);
  const sortOrders = formData.getAll("sort_orders").map(String);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const name = (names[i] ?? "").trim();
    if (!name) continue;
    const payload = {
      name,
      abbreviation: (abbreviations[i] ?? "").trim() || null,
      color_hex: normalizeHex(colors[i] ?? "#888888"),
      icon_type: (iconTypes[i] as IconType) || ("lucide" as IconType),
      icon_value: (iconValues[i] ?? "").trim() || null,
      sort_order: Number(sortOrders[i] ?? i),
    };
    const { error } = await supabase
      .from("nations")
      .update(payload)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
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
