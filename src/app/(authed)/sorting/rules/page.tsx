import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SortingRule } from "@/lib/db/types";
import { createRule } from "./actions";

export default async function RulesPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("sorting_rules")
    .select("*")
    .order("letter");
  const rules = (data ?? []) as SortingRule[];
  const usedLetters = new Set(rules.map((r) => r.letter));
  const nextLetter = (() => {
    for (let c = 65; c <= 90; c++) {
      const ch = String.fromCharCode(c);
      if (!usedLetters.has(ch)) return ch;
    }
    return "A";
  })();

  return (
    <div>
      <PageHeader
        title="Sorting rules"
        description="Up to 26 rules (RR-A through RR-Z). Newer rules trump older on conflicts."
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={createRule} className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Rule letter</Label>
              <Input
                name="letter"
                defaultValue={nextLetter}
                maxLength={1}
                required
                className="w-20 uppercase"
              />
            </div>
            <Button type="submit" size="sm">
              Add rule
            </Button>
          </form>
        </CardContent>
      </Card>

      <Table>
        <THead>
          <tr>
            <TH style={{ width: 80 }}>Rule</TH>
            <TH>Summary</TH>
            <TH style={{ width: 100 }}>Slot</TH>
            <TH style={{ width: 100 }}>Match</TH>
            <TH style={{ width: 100 }} />
          </tr>
        </THead>
        <TBody>
          {rules.map((r) => (
            <tr key={r.id}>
              <TD>
                <Badge variant="secondary" className="font-mono">
                  RR-{r.letter}
                </Badge>
              </TD>
              <TD className="text-sm">{r.summary ?? "—"}</TD>
              <TD className="font-mono">{r.destination_slot ?? "—"}</TD>
              <TD className="text-xs text-muted-foreground">{r.match_mode}</TD>
              <TD>
                <Link href={`/sorting/rules/${r.id}`}>
                  <Button size="sm" variant="secondary">
                    Edit
                  </Button>
                </Link>
              </TD>
            </tr>
          ))}
          {rules.length === 0 ? (
            <tr>
              <TD colSpan={5} className="text-center text-muted-foreground">
                No rules yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
