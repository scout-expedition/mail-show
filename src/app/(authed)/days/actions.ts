"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DayOfWeek, Phase } from "@/lib/db/enums";

function nilNum(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function nilStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function createDay() {
  const supabase = await createSupabaseServerClient();
  const { data: max } = await supabase
    .from("days")
    .select("number")
    .order("number", { ascending: false })
    .limit(1);
  const nextNumber = (max?.[0]?.number ?? -1) + 1;
  const { data, error } = await supabase
    .from("days")
    .insert({ number: nextNumber })
    .select("identifier")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/days");
  redirect(`/days/${data!.identifier.toLowerCase()}/overview`);
}

export async function updateDay(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    number: nilNum(formData.get("number")) ?? undefined,
    // Note: `days` has no `name` column; the form's `name` input (if any)
    // is intentionally ignored. The display label is auto-generated as
    // `identifier` (`D<n>`).
    notes: nilStr(formData.get("notes")),
    until_qup: nilNum(formData.get("until_qup")),
    month: nilNum(formData.get("month")),
    day_of_month: nilNum(formData.get("day_of_month")),
    year: nilNum(formData.get("year")),
    day_of_week: (nilStr(formData.get("day_of_week")) as DayOfWeek | null) ?? null,
    sort_phase_length_seconds: nilNum(formData.get("sort_phase_length_seconds")),
    inspection_phase_length_seconds: nilNum(
      formData.get("inspection_phase_length_seconds")
    ),
    base_report: nilStr(formData.get("base_report")),
    report_sign_off: nilStr(formData.get("report_sign_off")),
    end_of_day_sign_off: nilStr(formData.get("end_of_day_sign_off")),
  };
  const { error } = await supabase.from("days").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/days", "layout");
}

export async function deleteDay(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("days").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect("/days");
}

export async function advanceActivePlaythrough(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const playthrough_id = String(formData.get("playthrough_id") ?? "");
  const current_day_id = String(formData.get("current_day_id") ?? "") || null;
  const current_phase = String(formData.get("current_phase") ?? "") as Phase;
  if (!playthrough_id) return;
  const { error } = await supabase
    .from("playthroughs")
    .update({ current_day_id, current_phase })
    .eq("id", playthrough_id);
  if (error) throw new Error(error.message);
  revalidatePath("/days");
}
