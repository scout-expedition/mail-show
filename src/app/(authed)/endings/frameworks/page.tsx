import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
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
    { data: varData },
    { data: valueData },
  ] = await Promise.all([
    supabase.from("ending_frameworks").select("*").order("sort_order"),
    supabase.from("ending_framework_blocks").select("*").order("sort_order"),
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
  ]);

  return (
    <FrameworksWorkspace
      frameworks={(frameworkData ?? []) as EndingFramework[]}
      blocks={(blockData ?? []) as EndingFrameworkBlock[]}
      variables={(varData ?? []) as EndingVariable[]}
      values={(valueData ?? []) as EndingVariableValue[]}
      selectedFrameworkId={selectedId ?? null}
    />
  );
}
