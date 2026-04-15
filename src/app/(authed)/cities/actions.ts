"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function createCity() {
  const supabase = await createSupabaseServerClient();
  const { data: nations } = await supabase
    .from("nations")
    .select("id")
    .order("sort_order")
    .limit(1);
  const nation_id = nations?.[0]?.id;
  if (!nation_id) throw new Error("Create a nation before adding cities.");
  const { error } = await supabase
    .from("cities")
    .insert({ name: "New city", code: "NEW", nation_id });
  if (error) throw new Error(error.message);
  revalidatePath("/cities");
}

const CITY_CODE_RE = /^[A-Z0-9]{3} [A-Z0-9]{3}$/;

export async function updateAllCities(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const ids = formData.getAll("ids").map(String);
  const names = formData.getAll("names").map(String);
  const codes = formData.getAll("codes").map(String);
  const nationIds = formData.getAll("nation_ids").map(String);

  // Duplicate-code guard across the submitted rows.
  const seen = new Set<string>();
  for (const c of codes) {
    const k = c.trim();
    if (!k) continue;
    if (seen.has(k)) throw new Error(`Duplicate city code: ${k}`);
    seen.add(k);
  }

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id) continue;
    const name = (names[i] ?? "").trim();
    const code = (codes[i] ?? "").trim();
    const nation_id = (nationIds[i] ?? "").trim();
    if (!name || !nation_id) continue;
    if (!CITY_CODE_RE.test(code)) {
      throw new Error(`Invalid city code "${code}" — must be ABC DEF format.`);
    }
    const { error } = await supabase
      .from("cities")
      .update({ name, code, nation_id })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/cities");
}

/**
 * Parse a pasted block where each line is: "City, Code, Nation".
 * Accepts tab/comma/pipe separators. Nation matches by name (case-insensitive)
 * or abbreviation. Lines that fail validation are skipped.
 */
export async function bulkCreateCities(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const raw = String(formData.get("paste") ?? "").trim();
  if (!raw) return;

  const { data: nationData } = await supabase.from("nations").select("*");
  const nations = nationData ?? [];
  const byKey = new Map<string, string>();
  for (const n of nations) {
    byKey.set(String(n.name).toLowerCase(), n.id as string);
    if (n.abbreviation)
      byKey.set(String(n.abbreviation).toLowerCase(), n.id as string);
  }

  type Row = { name: string; code: string; nation_id: string };
  const rows: Row[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const parts = line
      .split(/\t|,|\|/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 3) continue;
    const [name, code, nationKey] = parts;
    const nation_id = byKey.get(nationKey.toLowerCase());
    if (!name || !code || !nation_id) continue;
    rows.push({ name, code, nation_id });
  }
  if (rows.length === 0) return;
  const { error } = await supabase.from("cities").insert(rows);
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
