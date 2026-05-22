"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function nilStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}
function nilNum(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------- Inspection letters ----------------
export async function createInspectionLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const letter_group_id = String(formData.get("letter_group_id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  if (!letter_group_id) return;
  const payload = {
    letter_group_id,
    variant: nilStr(formData.get("variant")),
    piece: nilNum(formData.get("piece")),
    summary: nilStr(formData.get("summary")),
    content: nilStr(formData.get("content")),
  };
  const { data, error } = await supabase
    .from("inspection_letters")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Seed default actions ("Deliver" + "Flag") so the editor isn't empty.
  // Actions reference templates by id now — find the seed templates by name
  // and skip the insert if they're missing (e.g., fresh DB without seeds).
  const { data: tpls } = await supabase
    .from("action_templates")
    .select("id, name, sort_order")
    .in("name", ["Deliver", "Flag"]);
  if (tpls && tpls.length > 0) {
    const rows = tpls
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t, i) => ({
        inspection_letter_id: data!.id,
        action_template_id: t.id,
        sort_order: i,
      }));
    await supabase.from("actions").insert(rows);
  }

  revalidatePath(`/inspection/storylines/${storyline_id}/groups/${letter_group_id}`);
}

export async function updateInspectionLetter(formData: FormData) {
  // Legacy form path. Does not expose `delivery_day_offset` — the modern
  // workspace handles relative delivery. Submitting a non-null
  // `delivery_day_override_id` here while an offset is set on the row would
  // hit the inspection_letters_delivery_exclusive CHECK constraint, so the
  // override field is always cleared to null below to keep the legacy form
  // safe; users must switch to the workspace to set any override.
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  const letter_group_id = String(formData.get("letter_group_id") ?? "");
  if (!id) return;
  const payload = {
    variant: nilStr(formData.get("variant")),
    piece: nilNum(formData.get("piece")),
    summary: nilStr(formData.get("summary")),
    content: nilStr(formData.get("content")),
    sender_citizen_id: nilStr(formData.get("sender_citizen_id")),
    receiver_citizen_id: nilStr(formData.get("receiver_citizen_id")),
    notes: nilStr(formData.get("notes")),
  };
  const { error } = await supabase
    .from("inspection_letters")
    .update(payload)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/inspection/storylines/${storyline_id}/groups/${letter_group_id}`);
}

export async function deleteInspectionLetter(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  const storyline_id = String(formData.get("storyline_id") ?? "");
  const letter_group_id = String(formData.get("letter_group_id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("inspection_letters").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect(`/inspection/storylines/${storyline_id}/groups/${letter_group_id}`);
}

// ---------------- Actions ----------------
// These server actions back the legacy storylines/[id]/groups/[groupId] form
// page. Display (name/icon/color) is sourced from action_templates now, so
// they only set FK + impact + report_segment_id fields.
export async function createAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const inspection_letter_id = String(formData.get("inspection_letter_id") ?? "");
  if (!inspection_letter_id) return;
  const { error } = await supabase.from("actions").insert({
    inspection_letter_id,
    action_template_id: nilStr(formData.get("action_template_id")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/storylines");
}

export async function updateAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    action_template_id: nilStr(formData.get("action_template_id")),
    report_segment_id: nilStr(formData.get("report_segment_id")),
    impact_world_status: Number(formData.get("impact_world_status") ?? 0),
    impact_demerits: Number(formData.get("impact_demerits") ?? 0),
    impact_proletariat: Number(formData.get("impact_proletariat") ?? 0),
    impact_gentry: Number(formData.get("impact_gentry") ?? 0),
    impact_epicenter: Number(formData.get("impact_epicenter") ?? 0),
    impact_folos: Number(formData.get("impact_folos") ?? 0),
    impact_emberlyn: Number(formData.get("impact_emberlyn") ?? 0),
    impact_spokgrad: Number(formData.get("impact_spokgrad") ?? 0),
    impact_pelico: Number(formData.get("impact_pelico") ?? 0),
  };
  const { error } = await supabase.from("actions").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/storylines");
}

export async function deleteAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("actions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/storylines");
}

// ---------------- Report segments ----------------
export async function createReportSegment(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const report_group_id = String(formData.get("report_group_id") ?? "");
  const variant = String(formData.get("variant") ?? "").trim();
  if (!report_group_id || !variant) return;
  const { error } = await supabase.from("report_segments").insert({
    report_group_id,
    variant,
    content: nilStr(formData.get("content")),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/storylines");
}

export async function updateReportSegment(formData: FormData) {
  // Legacy form path. See note on updateInspectionLetter above — the modern
  // workspace handles offsets; this form only edits variant/content/sort_order.
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    variant: String(formData.get("variant") ?? "").trim(),
    content: nilStr(formData.get("content")),
    sort_order: Number(formData.get("sort_order") ?? 0),
  };
  const { error } = await supabase
    .from("report_segments")
    .update(payload)
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/storylines");
}

export async function deleteReportSegment(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("report_segments").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/inspection/storylines");
}
