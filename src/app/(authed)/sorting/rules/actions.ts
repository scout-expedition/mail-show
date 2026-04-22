"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  RuleMatchMode,
  RuleOperator,
  RuleReferenceType,
  RuleTarget,
  RuleTargetSlice,
} from "@/lib/db/enums";

function nilStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function createRule() {
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("sorting_rules")
    .select("letter");
  const used = new Set((existing ?? []).map((r) => r.letter));
  let letter = "A";
  for (let c = 65; c <= 90; c++) {
    const ch = String.fromCharCode(c);
    if (!used.has(ch)) {
      letter = ch;
      break;
    }
  }
  const { data, error } = await supabase
    .from("sorting_rules")
    .insert({ letter, match_mode: "all" as RuleMatchMode })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/sorting/rules");
  redirect(`/sorting/rules/${data!.id}`);
}

export async function updateRule(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const payload = {
    letter: String(formData.get("letter") ?? "")
      .trim()
      .toUpperCase()
      .charAt(0),
    storage_location: nilStr(formData.get("storage_location")),
    summary: nilStr(formData.get("summary")),
    day_implemented_id: nilStr(formData.get("day_implemented_id")),
    destination_slot: Number(formData.get("destination_slot") ?? 0) || null,
    match_mode: String(formData.get("match_mode") ?? "all") as RuleMatchMode,
  };
  const { error } = await supabase.from("sorting_rules").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/sorting/rules/${id}`);
  revalidatePath(`/sorting/rules`);
}

export async function duplicateRule(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const { data: source } = await supabase
    .from("sorting_rules")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!source) return;

  const { data: existing } = await supabase
    .from("sorting_rules")
    .select("letter");
  const used = new Set((existing ?? []).map((r) => r.letter));
  let letter = "";
  for (let c = 65; c <= 90; c++) {
    const ch = String.fromCharCode(c);
    if (!used.has(ch)) {
      letter = ch;
      break;
    }
  }
  if (!letter) throw new Error("No free rule letter (A-Z) available.");

  const { data: inserted, error } = await supabase
    .from("sorting_rules")
    .insert({
      letter,
      storage_location: source.storage_location,
      summary: source.summary,
      day_implemented_id: source.day_implemented_id,
      destination_slot: source.destination_slot,
      match_mode: source.match_mode,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { data: conditions } = await supabase
    .from("sorting_rule_conditions")
    .select("*")
    .eq("rule_id", id)
    .order("position");
  if (conditions && conditions.length > 0) {
    const { error: cErr } = await supabase
      .from("sorting_rule_conditions")
      .insert(
        conditions.map((c) => ({
          rule_id: inserted!.id,
          position: c.position,
          target: c.target,
          target_slice: c.target_slice,
          operator: c.operator,
          reference_value: c.reference_value,
          reference_type: c.reference_type,
        }))
      );
    if (cErr) throw new Error(cErr.message);
  }

  revalidatePath("/sorting/rules");
}

export async function deleteRule(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("sorting_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect("/sorting/rules");
}

export async function saveRuleAll(data: {
  id: string;
  letter: string;
  destination_slot: number | null;
  day_implemented_id: string | null;
  storage_location: string | null;
  summary: string | null;
  match_mode: RuleMatchMode;
  conditions: Array<{
    target: RuleTarget;
    target_slice: RuleTargetSlice;
    operator: RuleOperator;
    reference_type: RuleReferenceType;
    reference_value: string | null;
  }>;
}) {
  const supabase = await createSupabaseServerClient();
  const { error: rErr } = await supabase
    .from("sorting_rules")
    .update({
      letter: data.letter,
      destination_slot: data.destination_slot,
      day_implemented_id: data.day_implemented_id,
      storage_location: data.storage_location,
      summary: data.summary,
      match_mode: data.match_mode,
    })
    .eq("id", data.id);
  if (rErr) throw new Error(rErr.message);

  const { error: delErr } = await supabase
    .from("sorting_rule_conditions")
    .delete()
    .eq("rule_id", data.id);
  if (delErr) throw new Error(delErr.message);
  if (data.conditions.length > 0) {
    const rows = data.conditions.map((c, i) => ({
      rule_id: data.id,
      position: i + 1,
      ...c,
    }));
    const { error } = await supabase
      .from("sorting_rule_conditions")
      .insert(rows);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/sorting/rules");
}

export async function saveConditions(
  ruleId: string,
  conditions: Array<{
    position: number;
    target: RuleTarget;
    target_slice: RuleTargetSlice;
    operator: RuleOperator;
    reference_type: RuleReferenceType;
    reference_value: string | null;
  }>,
  matchMode?: RuleMatchMode
) {
  "use server";
  const supabase = await createSupabaseServerClient();
  const { error: delErr } = await supabase
    .from("sorting_rule_conditions")
    .delete()
    .eq("rule_id", ruleId);
  if (delErr) throw new Error(delErr.message);
  if (conditions.length > 0) {
    const { error } = await supabase.from("sorting_rule_conditions").insert(
      conditions.map((c) => ({
        rule_id: ruleId,
        ...c,
      }))
    );
    if (error) throw new Error(error.message);
  }
  if (matchMode) {
    const { error } = await supabase
      .from("sorting_rules")
      .update({ match_mode: matchMode })
      .eq("id", ruleId);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/sorting/rules/${ruleId}`);
  revalidatePath(`/sorting/rules`);
}
