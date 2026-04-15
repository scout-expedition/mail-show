import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Storyline } from "@/lib/db/types";
import { createStoryline } from "./actions";

export default async function StorylinesPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("storylines")
    .select("*")
    .order("sort_order")
    .order("name");
  const storylines = (data ?? []) as Storyline[];

  return (
    <div>
      <PageHeader
        title="Storylines"
        description="Each storyline contains letter groups; each letter group contains inspection letters with player actions."
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={createStoryline} className="grid grid-cols-6 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input name="name" placeholder="Unity Day Event Planning" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Abbr (1 char)</Label>
              <Input name="abbreviation" maxLength={1} required placeholder="W" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Color</Label>
              <Input
                type="color"
                name="color_hex"
                defaultValue="#4b8eff"
                className="h-9 p-1"
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label>Icon (lucide name, emoji, or svg)</Label>
              <Input name="icon_value" placeholder="Flag / 🚩 / <svg>…</svg>" />
            </div>
            <div className="col-span-6 flex justify-end">
              <Button type="submit" size="sm">
                Add storyline
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Table>
        <THead>
          <tr>
            <TH style={{ width: 80 }}>Abbr</TH>
            <TH>Name</TH>
            <TH>Description</TH>
            <TH style={{ width: 100 }}>Color</TH>
            <TH style={{ width: 100 }} />
          </tr>
        </THead>
        <TBody>
          {storylines.map((s) => (
            <tr key={s.id}>
              <TD>
                <Badge variant="secondary" className="font-mono">
                  {s.abbreviation}
                </Badge>
              </TD>
              <TD className="font-medium">{s.name}</TD>
              <TD className="max-w-md truncate text-muted-foreground text-xs">
                {s.description ?? ""}
              </TD>
              <TD>
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ background: s.color_hex }}
                />
              </TD>
              <TD>
                <Link href={`/storylines/${s.id}`}>
                  <Button size="sm" variant="secondary">Open</Button>
                </Link>
              </TD>
            </tr>
          ))}
          {storylines.length === 0 ? (
            <tr>
              <TD colSpan={5} className="text-center text-muted-foreground">
                No storylines yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
