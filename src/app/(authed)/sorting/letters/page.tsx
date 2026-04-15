import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
        title="Sorting Letters"
        description="Letters the player must sort during the sorting phase of each day."
      />

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
          </tr>
        </THead>
        <TBody>
          {letters.map((l) => (
            <tr
              key={l.id}
              className="cursor-pointer transition-colors hover:bg-accent/40"
            >
              <TD className="p-0">
                <Link href={`/sorting/letters/${l.id}`} className="block px-3 py-2">
                  <Badge variant="secondary" className="font-mono">
                    {l.content_id}
                  </Badge>
                </Link>
              </TD>
              <TD className="p-0">
                <Link
                  href={`/sorting/letters/${l.id}`}
                  className="block px-3 py-2 font-mono text-xs"
                >
                  D{l.day_number}
                </Link>
              </TD>
              <TD className="p-0">
                <Link
                  href={`/sorting/letters/${l.id}`}
                  className="block px-3 py-2 text-xs text-muted-foreground"
                >
                  {l.recipient_name ?? "—"}
                </Link>
              </TD>
              <TD className="p-0">
                <Link
                  href={`/sorting/letters/${l.id}`}
                  className="block px-3 py-2 text-xs text-muted-foreground"
                >
                  {l.sender_name ?? "—"}
                </Link>
              </TD>
              <TD className="p-0">
                <Link href={`/sorting/letters/${l.id}`} className="block px-3 py-2">
                  {l.is_counterfeit ? (
                    <Badge variant="destructive">yes</Badge>
                  ) : (
                    "—"
                  )}
                </Link>
              </TD>
              <TD className="p-0">
                <Link
                  href={`/sorting/letters/${l.id}`}
                  className="block px-3 py-2 font-mono text-xs"
                >
                  {l.storage_location ?? "—"}
                </Link>
              </TD>
            </tr>
          ))}
          {letters.length === 0 ? (
            <tr>
              <TD colSpan={6} className="text-center text-muted-foreground">
                No sorting letters yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>

      <div className="mt-4 flex justify-center">
        <form action={createSortingLetter}>
          {day ? <input type="hidden" name="day_id" value={day} /> : null}
          <Button type="submit" variant="outline" size="sm">
            + Sorting letter
          </Button>
        </form>
      </div>
    </div>
  );
}
