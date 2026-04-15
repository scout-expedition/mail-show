"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}
function normalizeDomain(v: string): string {
  return v.trim().toLowerCase().replace(/^@/, "");
}

export async function addAllowlistEntry(formData: FormData) {
  const kind = String(formData.get("kind") ?? "");
  const raw = String(formData.get("value") ?? "");
  if (kind !== "email" && kind !== "domain") return;
  const value = kind === "email" ? normalizeEmail(raw) : normalizeDomain(raw);
  if (!value) return;
  if (kind === "email" && !value.includes("@")) return;
  if (kind === "domain" && value.includes("@")) return;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("allowed_emails")
    .insert({ kind, value });
  if (error && error.code !== "23505") throw new Error(error.message);
  revalidatePath("/settings");
}

export async function removeAllowlistEntry(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("allowed_emails").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
