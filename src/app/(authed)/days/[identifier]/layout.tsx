import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabBar, Tab } from "@/components/ui/tabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day } from "@/lib/db/types";
import { normalizeDayIdentifier } from "@/lib/db/days";

export default async function DayLayout({
  params,
  children,
}: {
  params: Promise<{ identifier: string }>;
  children: React.ReactNode;
}) {
  const { identifier } = await params;
  const ident = normalizeDayIdentifier(identifier);
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("days")
    .select("*")
    .eq("identifier", ident)
    .maybeSingle();
  if (!data) notFound();
  const day = data as Day;
  const slug = day.identifier.toLowerCase();

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Badge variant="secondary" className="font-mono text-sm">
              {day.identifier}
            </Badge>
            <span className="text-foreground">
              {day.name ?? `Day ${day.number}`}
            </span>
            {day.day_of_week ? (
              <span className="capitalize text-sm text-muted-foreground">
                {day.day_of_week}
              </span>
            ) : null}
          </span>
        }
        description={day.notes ?? "Edit the fields across the four phase tabs below."}
        actions={
          <Link href="/days">
            <Button variant="ghost" size="sm">
              All days
            </Button>
          </Link>
        }
      />
      <TabBar className="mb-6">
        <Tab href={`/days/${slug}/overview`}>Overview</Tab>
        <Tab href={`/days/${slug}/top-of-day`}>Top of Day</Tab>
        <Tab href={`/days/${slug}/sorting`}>Sorting</Tab>
        <Tab href={`/days/${slug}/inspection`}>Inspection</Tab>
        <Tab href={`/days/${slug}/end-of-day`}>End of Day</Tab>
      </TabBar>
      {children}
    </div>
  );
}
