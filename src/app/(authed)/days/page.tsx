import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const nextNumber = days.length > 0 ? Math.max(...days.map((d) => d.number)) + 1 : 0;

  return (
    <div>
      <PageHeader
        title="Days"
        description="Each game day has four phases: top of day, sorting, inspection, end of day."
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={createDay} className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Day number</Label>
              <Input
                type="number"
                name="number"
                required
                defaultValue={nextNumber}
                className="w-24"
              />
            </div>
            <Button type="submit" size="sm">
              Add day
            </Button>
          </form>
        </CardContent>
      </Card>

      <Table>
        <THead>
          <tr>
            <TH style={{ width: 80 }}>ID</TH>
            <TH>Date</TH>
            <TH>Day of week</TH>
            <TH>Until Q-up</TH>
            <TH>Notes</TH>
            <TH style={{ width: 100 }} />
          </tr>
        </THead>
        <TBody>
          {days.map((d) => (
            <tr key={d.id}>
              <TD>
                <Badge variant="secondary" className="font-mono">
                  {d.identifier}
                </Badge>
              </TD>
              <TD>
                {d.month && d.day_of_month && d.year ? (
                  <span className="font-mono text-xs">
                    {d.year}-{String(d.month).padStart(2, "0")}-
                    {String(d.day_of_month).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TD>
              <TD className="capitalize">{d.day_of_week ?? "—"}</TD>
              <TD className="font-mono tabular-nums">
                {d.until_qup ?? "—"}
              </TD>
              <TD className="max-w-sm truncate text-muted-foreground">
                {d.notes ?? ""}
              </TD>
              <TD>
                <Link href={`/days/${d.id}`}>
                  <Button size="sm" variant="secondary">
                    Open
                  </Button>
                </Link>
              </TD>
            </tr>
          ))}
          {days.length === 0 ? (
            <tr>
              <TD colSpan={6} className="text-center text-muted-foreground">
                No days yet. Add the first day above.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
