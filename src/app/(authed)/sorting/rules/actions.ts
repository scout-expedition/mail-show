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

export async function createRule(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const letter = String(formData.get("letter") ?? "")
    .trim()
    .toUpperCase();
  if (!letter || letter.length !== 1) return;
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

export async function deleteRule(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase.from("sorting_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
  redirect("/sorting/rules");
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
  }>
) {
  "use server";
  const supabase = await createSupabaseServerClient();
  // Replace-all for simplicity. This file is only authoring data.
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
  revalidatePath(`/sorting/rules/${ruleId}`);
}
