import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Citizen, City, Nation } from "@/lib/db/types";
import { CITIZEN_TYPES } from "@/lib/db/enums";
import { createCitizen, deleteCitizen, updateCitizen } from "./actions";

export default async function CitizensPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: citizenData }, { data: nationData }, { data: cityData }] =
    await Promise.all([
      supabase.from("citizens").select("*").order("name"),
      supabase.from("nations").select("*").order("sort_order"),
      supabase.from("cities").select("*").order("name"),
    ]);
  const citizens = (citizenData ?? []) as Citizen[];
  const nations = (nationData ?? []) as Nation[];
  const cities = (cityData ?? []) as City[];

  return (
    <div>
      <PageHeader
        title="Citizens"
        description="Hero and NPC characters referenced by letter senders, recipients, and addresses."
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={createCitizen} className="grid grid-cols-6 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input name="name" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select name="type" defaultValue="npc">
                {CITIZEN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Citizen ID</Label>
              <Input name="citizen_id" placeholder="#0042" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Nation</Label>
              <Select name="nation_id" defaultValue="">
                <option value="">—</option>
                {nations.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>City</Label>
              <Select name="city_id" defaultValue="">
                <option value="">—</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-6 flex justify-end">
              <Button type="submit" size="sm">
                Add citizen
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH style={{ width: 90 }}>Type</TH>
            <TH style={{ width: 120 }}>Citizen ID</TH>
            <TH style={{ width: 160 }}>Nation</TH>
            <TH style={{ width: 160 }}>City</TH>
            <TH style={{ width: 200 }} />
          </tr>
        </THead>
        <TBody>
          {citizens.map((c) => (
            <tr key={c.id}>
              <TD colSpan={5} className="!p-0">
                <form
                  id={`cit-form-${c.id}`}
                  action={updateCitizen}
                  className="grid grid-cols-[1fr_90px_120px_160px_160px] gap-2 px-3 py-2"
                >
                  <input type="hidden" name="id" value={c.id} />
                  <Input name="name" defaultValue={c.name} className="h-8" />
                  <Select name="type" defaultValue={c.type} className="h-8">
                    {CITIZEN_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                  <Input
                    name="citizen_id"
                    defaultValue={c.citizen_id ?? ""}
                    className="h-8"
                  />
                  <Select
                    name="nation_id"
                    defaultValue={c.nation_id ?? ""}
                    className="h-8"
                  >
                    <option value="">—</option>
                    {nations.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </Select>
                  <Select
                    name="city_id"
                    defaultValue={c.city_id ?? ""}
                    className="h-8"
                  >
                    <option value="">—</option>
                    {cities.map((ci) => (
                      <option key={ci.id} value={ci.id}>
                        {ci.name}
                      </option>
                    ))}
                  </Select>
                </form>
              </TD>
              <TD>
                <div className="flex items-center justify-end gap-2">
                  {c.type === "hero" ? (
                    <Badge variant="default">hero</Badge>
                  ) : null}
                  <Button
                    form={`cit-form-${c.id}`}
                    type="submit"
                    variant="secondary"
                    size="sm"
                  >
                    Save
                  </Button>
                  <form action={deleteCitizen}>
                    <input type="hidden" name="id" value={c.id} />
                    <Button type="submit" variant="destructive" size="sm">
                      Delete
                    </Button>
                  </form>
                </div>
              </TD>
            </tr>
          ))}
          {citizens.length === 0 ? (
            <tr>
              <TD colSpan={6} className="text-center text-muted-foreground">
                No citizens yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
