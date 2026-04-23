import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { groupSlug } from "@/lib/letter-groups";

export default async function OldGroupRedirect({
  params,
}: {
  params: Promise<{ id: string; groupId: string }>;
}) {
  const { groupId } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: group } = await supabase
    .from("letter_groups")
    .select("sequence, storylines(abbreviation)")
    .eq("id", groupId)
    .maybeSingle();
  const abbr = (group as unknown as {
    sequence: number;
    storylines: { abbreviation: string } | null;
  } | null)?.storylines?.abbreviation;
  if (!group || !abbr) notFound();
  redirect(`/inspection/letters?group=${groupSlug(abbr, group.sequence)}`);
}
