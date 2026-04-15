import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH style={{ width: 120 }}>Phase</TH>
            <TH style={{ width: 140 }}>Active</TH>
          </tr>
        </THead>
        <TBody>
          {playthroughs.map((p) => (
            <tr
              key={p.id}
              className="cursor-pointer transition-colors hover:bg-accent/40"
            >
              <TD className="p-0">
                <Link
                  href={`/playthroughs/${p.id}`}
                  className="block px-3 py-2 font-medium"
                >
                  {p.name}
                </Link>
              </TD>
              <TD className="p-0">
                <Link
                  href={`/playthroughs/${p.id}`}
                  className="block px-3 py-2 text-xs text-muted-foreground"
                >
                  {p.current_phase}
                </Link>
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
            </tr>
          ))}
          {playthroughs.length === 0 ? (
            <tr>
              <TD colSpan={3} className="text-center text-muted-foreground">
                No playthroughs yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>

      <div className="mt-4 flex justify-center">
        <form action={createPlaythrough}>
          <Button type="submit" variant="outline" size="sm">
            + Playthrough
          </Button>
        </form>
      </div>
    </div>
  );
}
