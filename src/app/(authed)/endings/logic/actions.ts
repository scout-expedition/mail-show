"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function revalidateEndings() {
  revalidatePath("/endings/variables");
  revalidatePath("/endings/logic");
  revalidatePath("/endings/frameworks");
  revalidatePath("/inspection/letters");
}

export async function createLogicRule(): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: fw } = await supabase
    .from("ending_frameworks")
    .select("id")
    .order("sort_order")
    .limit(1);
  const framework_id = fw?.[0]?.id;
  if (!framework_id)
    throw new Error("Create a framework before adding logic rules.");

  const { data: existing } = await supabase
    .from("ending_logic_rules")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = (existing?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("ending_logic_rules")
    .insert({ framework_id, sort_order: nextSort })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidateEndings();
  return { id: data.id as string };
}

export async function deleteLogicRule(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const { error } = await supabase
    .from("ending_logic_rules")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidateEndings();
}

type RulePayload = {
  id: string;
  framework_id: string;
  sort_order: number;
  conditions: Array<{ variable_id: string; value_id: string }>;
};

export async function saveAllLogicRules(rules: RulePayload[]) {
  const supabase = await createSupabaseServerClient();
  for (const r of rules) {
    if (!r.framework_id)
      throw new Error("Every rule must point at a framework.");
    const { error } = await supabase
      .from("ending_logic_rules")
      .update({ framework_id: r.framework_id, sort_order: r.sort_order })
      .eq("id", r.id);
    if (error) throw new Error(error.message);

    const { error: delErr } = await supabase
      .from("ending_logic_rule_conditions")
      .delete()
      .eq("rule_id", r.id);
    if (delErr) throw new Error(delErr.message);

    if (r.conditions.length > 0) {
      const seen = new Set<string>();
      const rows: Array<{
        rule_id: string;
        variable_id: string;
        value_id: string;
      }> = [];
      for (const c of r.conditions) {
        if (!c.variable_id || !c.value_id) continue;
        if (seen.has(c.variable_id)) continue;
        seen.add(c.variable_id);
        rows.push({
          rule_id: r.id,
          variable_id: c.variable_id,
          value_id: c.value_id,
        });
      }
      if (rows.length > 0) {
        const { error: insErr } = await supabase
          .from("ending_logic_rule_conditions")
          .insert(rows);
        if (insErr) throw new Error(insErr.message);
      }
    }
  }
  revalidateEndings();
}
