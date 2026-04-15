import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Playthrough } from "@/lib/db/types";
import {
  clearActivePlaythrough,
  createPlaythrough,
  setActivePlaythrough,
} from "./actions";

export default async function PlaythroughsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("playthroughs")
    .select("*")
    .order("created_at", { ascending: false });
  const playthroughs = (data ?? []) as Playthrough[];

  return (
    <div>
      <PageHeader
        title="Playthroughs"
        description="Named test runs. One can be 'active' at a time — it drives the HUD and the greying on the Top of Day view."
        actions={
          <form action={clearActivePlaythrough}>
            <Button type="submit" variant="ghost" size="sm">
              Clear active
            </Button>
          </form>
        }
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={createPlaythrough} className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label>Name</Label>
              <Input name="name" placeholder="Rebel run" required />
            </div>
            <Button type="submit" size="sm">
              New playthrough
            </Button>
          </form>
        </CardContent>
      </Card>

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH style={{ width: 120 }}>Phase</TH>
            <TH style={{ width: 120 }}>Active</TH>
            <TH style={{ width: 200 }} />
          </tr>
        </THead>
        <TBody>
          {playthroughs.map((p) => (
            <tr key={p.id}>
              <TD className="font-medium">{p.name}</TD>
              <TD className="text-xs text-muted-foreground">
                {p.current_phase}
              </TD>
              <TD>
                {p.is_active ? (
                  <Badge variant="success">active</Badge>
                ) : (
                  <form action={setActivePlaythrough}>
                    <input type="hidden" name="id" value={p.id} />
                    <Button type="submit" size="sm" variant="secondary">
                      Make active
                    </Button>
                  </form>
                )}
              </TD>
              <TD>
                <Link href={`/playthroughs/${p.id}`}>
                  <Button size="sm" variant="secondary">
                    Open
                  </Button>
                </Link>
              </TD>
            </tr>
          ))}
          {playthroughs.length === 0 ? (
            <tr>
              <TD colSpan={4} className="text-center text-muted-foreground">
                No playthroughs yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
