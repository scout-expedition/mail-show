import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  EndingConditionRow,
  EndingConditionRowChip,
  EndingFramework,
  EndingFrameworkBlock,
  EndingVariable,
  EndingVariableValue,
} from "@/lib/db/types";
import { FrameworksWorkspace } from "./workspace";

export default async function FrameworksPage({
  searchParams,
}: {
  searchParams: Promise<{ framework?: string }>;
}) {
  const { framework: selectedId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [
    { data: frameworkData },
    { data: blockData },
    { data: rowData },
    { data: chipData },
    { data: varData },
    { data: valueData },
  ] = await Promise.all([
    supabase.from("ending_frameworks").select("*").order("sort_order"),
    supabase.from("ending_framework_blocks").select("*").order("sort_order"),
    supabase.from("ending_condition_rows").select("*").order("sort_order"),
    supabase
      .from("ending_condition_row_chips")
      .select("*")
      .order("sort_order"),
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
  ]);

  return (
    <FrameworksWorkspace
      frameworks={(frameworkData ?? []) as EndingFramework[]}
      blocks={(blockData ?? []) as EndingFrameworkBlock[]}
      rows={(rowData ?? []) as EndingConditionRow[]}
      chips={(chipData ?? []) as EndingConditionRowChip[]}
      variables={(varData ?? []) as EndingVariable[]}
      values={(valueData ?? []) as EndingVariableValue[]}
      selectedFrameworkId={selectedId ?? null}
    />
  );
}
