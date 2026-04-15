import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day } from "@/lib/db/types";
import { normalizeDayIdentifier } from "@/lib/db/days";
import { DayOverviewForm } from "./day-overview-form";

export default async function OverviewTab({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const ident = normalizeDayIdentifier(identifier);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("days")
    .select("*")
    .eq("identifier", ident)
    .maybeSingle();
  const day = data as Day | null;
  if (!day) return null;
  return <DayOverviewForm day={day} />;
}
