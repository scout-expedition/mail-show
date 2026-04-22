"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeHex } from "@/lib/color";
import type { IconType } from "@/lib/db/enums";

export async function createActionTemplate() {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("action_templates")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;
  const { error } = await supabase.from("action_templates").insert({
    name: "New action",
    icon_type: "lucide" as IconType,
    color_hex: "#888888",
    sort_order: nextSort,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/actions");
}

export async function updateAllActionTemplates(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const ids = formData.getAll("ids").map(String);
  const names = formData.getAll("names").map(String);
  const iconTypes = formData.getAll("icon_types").map(String);
  const iconValues = formData.getAll("icon_values").map(String);
  const colors = formData.getAll("colors").map(String);
  const sortOrders = formData.getAll("sort_orders").map(String);

  const pairedIds = formData.getAll("paired_template_ids").map(String);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const payload = {
      name: (names[i] ?? "").trim(),
      icon_type: (iconTypes[i] ?? "lucide") as IconType,
      icon_value: iconValues[i] ? iconValues[i] : null,
      color_hex: normalizeHex(colors[i] ?? "#888888"),
      sort_order: Number(sortOrders[i] ?? 0) || 0,
      paired_template_id: null as string | null,
    };
    if (!payload.name) continue;
    const { error } = await supabase
      .from("action_templates")
      .update(payload)
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  // Second pass: write pair links symmetrically.
  const written = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i];
    const b = pairedIds[i];
    if (!a || !b || a === b) continue;
    if (written.has(a) || written.has(b)) continue;
    const { error: e1 } = await supabase
      .from("action_templates")
      .update({ paired_template_id: b })
      .eq("id", a);
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await supabase
      .from("action_templates")
      .update({ paired_template_id: a })
      .eq("id", b);
    if (e2) throw new Error(e2.message);
    written.add(a);
    written.add(b);
  }
  revalidatePath("/inspection/actions");
  revalidatePath("/inspection/letters");
}

export async function deleteActionTemplate(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase
    .from("action_templates")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/actions");
}
