import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
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
            <TH className="whitespace-nowrap text-center" style={{ width: 1 }}>ID</TH>
            <TH className="whitespace-nowrap" style={{ width: 1 }}>Days Until QUP</TH>
            <TH style={{ width: 180 }}>Name</TH>
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
                <TD className="p-0 text-center">
                  <Link href={`/days/${slug}/overview`} className="block px-3 py-2">
                    <span className="inline-flex items-center rounded-full bg-foreground/25 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                      {d.identifier}
                    </span>
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
                  <Link href={`/days/${slug}/overview`} className="block px-3 py-2">
                    {d.name ?? <span className="text-muted-foreground">—</span>}
                  </Link>
                </TD>
                <TD className="p-0">
                  <Link
                    href={`/days/${slug}/overview`}
                    className="block px-3 py-2 text-muted-foreground"
                  >
                    {d.notes ?? ""}
                  </Link>
                </TD>
              </tr>
            );
          })}
          {days.length === 0 ? (
            <tr>
              <TD colSpan={4} className="text-center text-muted-foreground">
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
