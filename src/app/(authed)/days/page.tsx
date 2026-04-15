import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day } from "@/lib/db/types";
import { createDay } from "./actions";

export default async function DaysPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("days")
    .select("*")
    .order("number", { ascending: true });
  const days = (data ?? []) as Day[];

  return (
    <div>
      <PageHeader
        title="Days"
        description="Each game day has four phases: top of day, sorting, inspection, end of day."
      />

      <Table>
        <THead>
          <tr>
            <TH style={{ width: 80 }}>ID</TH>
            <TH>Name</TH>
            <TH>Date</TH>
            <TH>Day of week</TH>
            <TH>Until Q-up</TH>
            <TH>Notes</TH>
          </tr>
        </THead>
        <TBody>
          {days.map((d) => {
            const slug = d.identifier.toLowerCase();
            return (
              <tr
                key={d.id}
                className="group cursor-pointer transition-colors hover:bg-accent/40"
              >
                <TD className="p-0">
                  <Link href={`/days/${slug}/overview`} className="block px-3 py-2">
                    <Badge variant="secondary" className="font-mono">
                      {d.identifier}
                    </Badge>
                  </Link>
                </TD>
                <TD className="p-0">
                  <Link href={`/days/${slug}/overview`} className="block px-3 py-2">
                    {d.name ?? <span className="text-muted-foreground">—</span>}
                  </Link>
                </TD>
                <TD className="p-0">
                  <Link href={`/days/${slug}/overview`} className="block px-3 py-2">
                    {d.month && d.day_of_month && d.year ? (
                      <span className="font-mono text-xs">
                        {d.year}-{String(d.month).padStart(2, "0")}-
                        {String(d.day_of_month).padStart(2, "0")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </Link>
                </TD>
                <TD className="p-0">
                  <Link
                    href={`/days/${slug}/overview`}
                    className="block px-3 py-2 capitalize"
                  >
                    {d.day_of_week ?? "—"}
                  </Link>
                </TD>
                <TD className="p-0">
                  <Link
                    href={`/days/${slug}/overview`}
                    className="block px-3 py-2 font-mono tabular-nums"
                  >
                    {d.until_qup ?? "—"}
                  </Link>
                </TD>
                <TD className="p-0">
                  <Link
                    href={`/days/${slug}/overview`}
                    className="block max-w-sm truncate px-3 py-2 text-muted-foreground"
                  >
                    {d.notes ?? ""}
                  </Link>
                </TD>
              </tr>
            );
          })}
          {days.length === 0 ? (
            <tr>
              <TD colSpan={6} className="text-center text-muted-foreground">
                No days yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>

      <div className="mt-4 flex justify-center">
        <form action={createDay}>
          <Button type="submit" variant="outline" size="sm">
            + Day
          </Button>
        </form>
      </div>
    </div>
  );
}
