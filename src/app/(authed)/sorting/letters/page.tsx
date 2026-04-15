import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day, SortingLetterView } from "@/lib/db/types";
import { createSortingLetter } from "./actions";

export default async function SortingLettersPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { day } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: daysData }, lettersRes] = await Promise.all([
    supabase.from("days").select("*").order("number"),
    (async () => {
      let q = supabase
        .from("sorting_letters_view")
        .select("*")
        .order("day_number")
        .order("sort_id");
      if (day) q = q.eq("day_id", day);
      return q;
    })(),
  ]);

  const days = (daysData ?? []) as Day[];
  const letters = (lettersRes.data ?? []) as SortingLetterView[];

  return (
    <div>
      <PageHeader
        title="Sorting letters"
        description="Letters the player must sort during the sorting phase of each day."
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={createSortingLetter} className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Day</Label>
              <Select name="day_id" required defaultValue="">
                <option value="" disabled>
                  Select day
                </option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.identifier}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" size="sm">
              Add sorting letter
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Label>Filter</Label>
        <Link
          href="/sorting/letters"
          className={
            !day
              ? "rounded-md bg-accent px-2 py-0.5 text-xs"
              : "rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          All
        </Link>
        {days.map((d) => (
          <Link
            key={d.id}
            href={`/sorting/letters?day=${d.id}`}
            className={
              day === d.id
                ? "rounded-md bg-accent px-2 py-0.5 text-xs font-mono"
                : "rounded-md px-2 py-0.5 text-xs font-mono text-muted-foreground hover:text-foreground"
            }
          >
            {d.identifier}
          </Link>
        ))}
      </div>

      <Table>
        <THead>
          <tr>
            <TH style={{ width: 90 }}>ID</TH>
            <TH style={{ width: 60 }}>Day</TH>
            <TH>Recipient</TH>
            <TH>Sender</TH>
            <TH style={{ width: 80 }}>Fake?</TH>
            <TH style={{ width: 120 }}>Storage</TH>
            <TH style={{ width: 100 }} />
          </tr>
        </THead>
        <TBody>
          {letters.map((l) => (
            <tr key={l.id}>
              <TD>
                <Badge variant="secondary" className="font-mono">
                  {l.content_id}
                </Badge>
              </TD>
              <TD className="font-mono text-xs">D{l.day_number}</TD>
              <TD className="text-xs text-muted-foreground">
                {l.recipient_name ?? "—"}
              </TD>
              <TD className="text-xs text-muted-foreground">
                {l.sender_name ?? "—"}
              </TD>
              <TD>
                {l.is_counterfeit ? (
                  <Badge variant="destructive">yes</Badge>
                ) : (
                  "—"
                )}
              </TD>
              <TD className="font-mono text-xs">{l.storage_location ?? "—"}</TD>
              <TD>
                <Link href={`/sorting/letters/${l.id}`}>
                  <Button size="sm" variant="secondary">
                    Edit
                  </Button>
                </Link>
              </TD>
            </tr>
          ))}
          {letters.length === 0 ? (
            <tr>
              <TD colSpan={7} className="text-center text-muted-foreground">
                No sorting letters yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
