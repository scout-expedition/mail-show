import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { City, Nation } from "@/lib/db/types";
import { createCity, deleteCity, updateCity } from "./actions";

export default async function CitiesPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: cityData }, { data: nationData }] = await Promise.all([
    supabase.from("cities").select("*").order("name"),
    supabase.from("nations").select("*").order("sort_order"),
  ]);
  const cities = (cityData ?? []) as City[];
  const nations = (nationData ?? []) as Nation[];
  const nationMap = new Map(nations.map((n) => [n.id, n]));

  return (
    <div>
      <PageHeader
        title="Cities"
        description="Each city has a code and belongs to a nation."
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={createCity} className="grid grid-cols-4 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input name="name" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Code</Label>
              <Input name="code" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Nation</Label>
              <Select name="nation_id" required defaultValue="">
                <option value="" disabled>
                  Select nation
                </option>
                {nations.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-4 flex justify-end">
              <Button type="submit" size="sm">
                Add city
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH style={{ width: 120 }}>Code</TH>
            <TH style={{ width: 200 }}>Nation</TH>
            <TH style={{ width: 200 }} />
          </tr>
        </THead>
        <TBody>
          {cities.map((c) => {
            const n = nationMap.get(c.nation_id);
            return (
              <tr key={c.id}>
                <TD colSpan={3} className="!p-0">
                  <form
                    id={`city-form-${c.id}`}
                    action={updateCity}
                    className="grid grid-cols-[1fr_120px_200px] gap-2 px-3 py-2"
                  >
                    <input type="hidden" name="id" value={c.id} />
                    <Input name="name" defaultValue={c.name} className="h-8" />
                    <Input name="code" defaultValue={c.code} className="h-8" />
                    <Select
                      name="nation_id"
                      defaultValue={c.nation_id}
                      className="h-8"
                    >
                      {nations.map((nn) => (
                        <option key={nn.id} value={nn.id}>
                          {nn.name}
                        </option>
                      ))}
                    </Select>
                  </form>
                </TD>
                <TD>
                  <div className="flex items-center justify-between gap-2">
                    {n ? (
                      <span
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ background: n.color_hex }}
                      />
                    ) : null}
                    <div className="ml-auto flex gap-2">
                      <Button
                        type="submit"
                        form={`city-form-${c.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        Save
                      </Button>
                      <form action={deleteCity}>
                        <input type="hidden" name="id" value={c.id} />
                        <Button type="submit" variant="destructive" size="sm">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </div>
                </TD>
              </tr>
            );
          })}
          {cities.length === 0 ? (
            <tr>
              <TD colSpan={4} className="text-center text-muted-foreground">
                No cities yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
