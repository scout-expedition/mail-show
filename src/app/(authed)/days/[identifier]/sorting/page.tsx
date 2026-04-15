import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Day, SortingLetterView, SortingRule } from "@/lib/db/types";
import { normalizeDayIdentifier } from "@/lib/db/days";

function formatSeconds(s: number | null | undefined): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default async function SortingTab({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const ident = normalizeDayIdentifier(identifier);
  const supabase = await createSupabaseServerClient();

  const { data: dayData } = await supabase
    .from("days")
    .select("*")
    .eq("identifier", ident)
    .maybeSingle();
  const day0 = dayData as Day | null;
  if (!day0) return null;
  const id = day0.id;

  const [{ data: letterData }, { data: ruleData }] =
    await Promise.all([
      supabase
        .from("sorting_letters_view")
        .select("*")
        .eq("day_id", id)
        .order("sort_id"),
      supabase
        .from("sorting_rules")
        .select("*")
        .order("letter"),
    ]);
  const day = day0;
  const letters = (letterData ?? []) as SortingLetterView[];
  const rules = (ruleData ?? []) as SortingRule[];
  const activeRules = day
    ? rules.filter((r) => !!r.day_implemented_id)
    : rules;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Sorting letters</CardTitle>
            <CardDescription>
              Letters the player must sort on day {day?.number}. Phase length:{" "}
              <span className="font-mono">
                {formatSeconds(day?.sort_phase_length_seconds)}
              </span>
            </CardDescription>
          </div>
          <Link href="/sorting/letters">
            <Button size="sm" variant="secondary">
              All sorting letters
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <tr>
                <TH style={{ width: 90 }}>ID</TH>
                <TH style={{ width: 90 }}>Counterfeit?</TH>
                <TH>Recipient</TH>
                <TH>Sender</TH>
                <TH style={{ width: 120 }}>Storage</TH>
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
                  <TD>
                    {l.is_counterfeit ? (
                      <Badge variant="destructive">counterfeit</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD className="text-xs text-muted-foreground">
                    {l.recipient_name ?? "—"}
                  </TD>
                  <TD className="text-xs text-muted-foreground">
                    {l.sender_name ?? "—"}
                  </TD>
                  <TD className="font-mono text-xs">{l.storage_location ?? "—"}</TD>
                </tr>
              ))}
              {letters.length === 0 ? (
                <tr>
                  <TD colSpan={5} className="text-center text-muted-foreground">
                    No sorting letters on this day.
                  </TD>
                </tr>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Rules in play</CardTitle>
            <CardDescription>
              Sorting rules the player should be using on this day (conflict resolution:
              newer rules trump older).
            </CardDescription>
          </div>
          <Link href="/sorting/rules">
            <Button size="sm" variant="secondary">
              Edit rules
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <tr>
                <TH style={{ width: 80 }}>Rule</TH>
                <TH>Summary</TH>
                <TH style={{ width: 80 }}>Slot</TH>
                <TH style={{ width: 160 }}>Implemented</TH>
              </tr>
            </THead>
            <TBody>
              {activeRules.map((r) => (
                <tr key={r.id}>
                  <TD>
                    <Badge variant="secondary" className="font-mono">
                      RR-{r.letter}
                    </Badge>
                  </TD>
                  <TD className="text-sm">{r.summary ?? "—"}</TD>
                  <TD className="font-mono">{r.destination_slot ?? "—"}</TD>
                  <TD className="text-xs text-muted-foreground">
                    {r.day_implemented_id ? "linked day" : "—"}
                  </TD>
                </tr>
              ))}
              {activeRules.length === 0 ? (
                <tr>
                  <TD colSpan={4} className="text-center text-muted-foreground">
                    No rules defined yet.
                  </TD>
                </tr>
              ) : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
