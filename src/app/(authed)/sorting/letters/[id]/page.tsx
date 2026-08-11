import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { AddressBlock } from "@/components/address-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { City, Day, Nation, SortingLetterView } from "@/lib/db/types";
import { deleteSortingLetter, updateSortingLetter } from "../actions";

export default async function SortingLetterDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: lData }, { data: dData }, { data: cData }, { data: nData }] =
    await Promise.all([
      supabase
        .from("sorting_letters_view")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
      supabase.from("days").select("*").order("number"),
      supabase.from("cities").select("*").order("name"),
      supabase.from("nations").select("*").order("sort_order"),
    ]);
  if (!lData) notFound();
  const letter = lData as SortingLetterView;
  const days = (dData ?? []) as Day[];
  const cities = (cData ?? []) as City[];
  const nations = (nData ?? []) as Nation[];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono">
              {letter.content_id}
            </Badge>
            <span className="text-muted-foreground">Sorting Letter</span>
          </span>
        }
        actions={
          <div className="flex gap-2">
            <Link href="/sorting/letters">
              <Button variant="ghost" size="sm">
                All
              </Button>
            </Link>
            <form action={deleteSortingLetter}>
              <input type="hidden" name="id" value={letter.id} />
              <Button type="submit" variant="destructive" size="sm">
                Delete
              </Button>
            </form>
          </div>
        }
      />

      <Card>
        <CardContent className="pt-5">
          <form action={updateSortingLetter} className="grid grid-cols-6 gap-4">
            <input type="hidden" name="id" value={letter.id} />

            <div className="flex flex-col gap-1.5 col-span-2">
              <Label>Day</Label>
              <Select name="day_id" defaultValue={letter.day_id}>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.identifier}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Sort ID (0-99)</Label>
              <Input
                type="number"
                name="sort_id"
                defaultValue={letter.sort_id}
                min={0}
                max={99}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <Label>Storage location</Label>
              <Input
                name="storage_location"
                defaultValue={letter.storage_location ?? ""}
                placeholder="Bin 4 / Blue Bin"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="stamp_valid"
                  defaultChecked={letter.stamp_valid}
                  className="h-4 w-4"
                />
                Stamp valid
              </label>
            </div>

            <div className="col-span-6 grid grid-cols-2 gap-4">
              <AddressBlock
                prefix="recipient"
                label="Recipient"
                values={{
                  type: letter.recipient_type,
                  citizen_number: letter.recipient_citizen_number,
                  name: letter.recipient_name,
                  city_id: letter.recipient_city_id,
                  city_name: letter.recipient_city_name,
                  city_code: letter.recipient_city_code,
                  nation_id: letter.recipient_nation_id,
                }}
                cities={cities}
                nations={nations}
              />
              <AddressBlock
                prefix="sender"
                label="Sender"
                values={{
                  type: letter.sender_type,
                  citizen_number: letter.sender_citizen_number,
                  name: letter.sender_name,
                  city_id: letter.sender_city_id,
                  city_name: letter.sender_city_name,
                  city_code: letter.sender_city_code,
                  nation_id: letter.sender_nation_id,
                }}
                cities={cities}
                nations={nations}
              />
            </div>

            <div className="col-span-6 flex flex-col gap-1.5">
              <Label>Notes</Label>
              <Textarea name="notes" defaultValue={letter.notes ?? ""} rows={2} />
            </div>
            <div className="col-span-6 flex justify-end">
              <Button type="submit">Save sorting letter</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
