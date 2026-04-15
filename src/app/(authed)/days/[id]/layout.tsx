import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabBar, Tab } from "@/components/ui/tabs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day } from "@/lib/db/types";
import { deleteDay } from "../actions";

export default async function DayLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("days").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const day = data as Day;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Badge variant="secondary" className="font-mono text-sm">
              {day.identifier}
            </Badge>
            <span className="capitalize text-muted-foreground">
              {day.day_of_week ?? "unscheduled"}
            </span>
          </span>
        }
        description={day.notes ?? "Edit the fields across the four phase tabs below."}
        actions={
          <div className="flex gap-2">
            <Link href="/days">
              <Button variant="ghost" size="sm">
                All days
              </Button>
            </Link>
            <form action={deleteDay}>
              <input type="hidden" name="id" value={day.id} />
              <Button
                type="submit"
                variant="destructive"
                size="sm"
              >
                Delete day
              </Button>
            </form>
          </div>
        }
      />
      <TabBar className="mb-6">
        <Tab href={`/days/${day.id}/overview`}>Overview</Tab>
        <Tab href={`/days/${day.id}/top-of-day`}>Top of Day</Tab>
        <Tab href={`/days/${day.id}/sorting`}>Sorting</Tab>
        <Tab href={`/days/${day.id}/inspection`}>Inspection</Tab>
        <Tab href={`/days/${day.id}/end-of-day`}>End of Day</Tab>
      </TabBar>
      {children}
    </div>
  );
}
