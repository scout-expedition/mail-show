import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  EndingBlock,
  EndingConditionBlockVariable,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingDocument,
  EndingVariable,
  EndingVariableValue,
  Nation,
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
    { data: documentData },
    { data: blockData },
    { data: rowData },
    { data: chipData },
    { data: blockVarData },
    { data: varData },
    { data: valueData },
    { data: nationData },
  ] = await Promise.all([
    supabase
      .from("ending_documents")
      .select("*")
      .eq("kind", "framework")
      .order("sort_order"),
    supabase.from("ending_blocks").select("*").order("sort_order"),
    supabase.from("ending_condition_rows").select("*").order("sort_order"),
    supabase
      .from("ending_condition_row_chips")
      .select("*")
      .order("sort_order"),
    supabase
      .from("ending_condition_block_variables")
      .select("*")
      .order("sort_order"),
    supabase.from("ending_variables").select("*").order("sort_order"),
    supabase.from("ending_variable_values").select("*").order("sort_order"),
    supabase.from("nations").select("name, color_hex"),
  ]);

  // Filter blocks to those whose document_id is one of our framework
  // docs — saves a JOIN at the cost of a tiny client-side filter.
  const frameworkDocs = (documentData ?? []) as EndingDocument[];
  const frameworkIds = new Set(frameworkDocs.map((d) => d.id));
  const frameworkBlocks = ((blockData ?? []) as EndingBlock[]).filter((b) =>
    frameworkIds.has(b.document_id)
  );

  return (
    <FrameworksWorkspace
      frameworks={frameworkDocs}
      blocks={frameworkBlocks}
      rows={(rowData ?? []) as EndingConditionRow[]}
      chips={(chipData ?? []) as EndingConditionRowChip[]}
      blockVariables={
        (blockVarData ?? []) as EndingConditionBlockVariable[]
      }
      variables={(varData ?? []) as EndingVariable[]}
      values={(valueData ?? []) as EndingVariableValue[]}
      nations={(nationData ?? []) as Pick<Nation, "name" | "color_hex">[]}
      selectedFrameworkId={selectedId ?? null}
    />
  );
}
