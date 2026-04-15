import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Nation } from "@/lib/db/types";
import { createNation, deleteNation, updateNation } from "./actions";

export default async function NationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("nations")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  const nations = (data ?? []) as Nation[];

  return (
    <div>
      <PageHeader
        title="Nations"
        description="The five nations of the game. Each has a display color used across the app."
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={createNation} className="grid grid-cols-4 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input name="name" id="name" required placeholder="Epicenter" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="abbreviation">Abbreviation</Label>
              <Input
                name="abbreviation"
                id="abbreviation"
                maxLength={1}
                placeholder="E"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="color_hex">Color</Label>
              <Input
                type="color"
                name="color_hex"
                id="color_hex"
                defaultValue="#888888"
                className="h-9 w-full cursor-pointer p-1"
              />
            </div>
            <div className="col-span-4 flex justify-end">
              <Button type="submit" size="sm">
                Add nation
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Table>
        <THead>
          <tr>
            <TH style={{ width: 24 }} />
            <TH>Name</TH>
            <TH style={{ width: 80 }}>Abbr</TH>
            <TH style={{ width: 80 }}>Color</TH>
            <TH style={{ width: 80 }}>Sort</TH>
            <TH style={{ width: 200 }} />
          </tr>
        </THead>
        <TBody>
          {nations.map((n) => (
            <tr key={n.id}>
              <TD>
                <span
                  className="inline-block h-4 w-4 rounded-full border border-border"
                  style={{ background: n.color_hex }}
                />
              </TD>
              <TD colSpan={4} className="!p-0">
                <form
                  action={updateNation}
                  className="grid grid-cols-[1fr_80px_80px_80px] gap-2 px-3 py-2"
                  id={`nation-form-${n.id}`}
                >
                  <input type="hidden" name="id" value={n.id} />
                  <Input
                    name="name"
                    defaultValue={n.name}
                    className="h-8"
                    required
                  />
                  <Input
                    name="abbreviation"
                    defaultValue={n.abbreviation ?? ""}
                    maxLength={1}
                    className="h-8"
                  />
                  <Input
                    type="color"
                    name="color_hex"
                    defaultValue={n.color_hex}
                    className="h-8 p-1"
                  />
                  <Input
                    type="number"
                    name="sort_order"
                    defaultValue={n.sort_order}
                    className="h-8"
                  />
                </form>
              </TD>
              <TD>
                <div className="flex justify-end gap-2">
                  <Button
                    type="submit"
                    form={`nation-form-${n.id}`}
                    variant="secondary"
                    size="sm"
                  >
                    Save
                  </Button>
                  <form action={deleteNation}>
                    <input type="hidden" name="id" value={n.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      Delete
                    </Button>
                  </form>
                </div>
              </TD>
            </tr>
          ))}
          {nations.length === 0 ? (
            <tr>
              <TD colSpan={6} className="text-center text-muted-foreground">
                No nations yet. Add one above.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
