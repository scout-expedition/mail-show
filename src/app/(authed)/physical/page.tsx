import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead } from "@/components/ui/table";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  InspectionLetterView,
  PhysicalLetter,
  SortingLetterView,
} from "@/lib/db/types";
import {
  createPhysicalLetter,
  deletePhysicalLetter,
  updatePhysicalLetter,
} from "./actions";

export default async function PhysicalLettersPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: pData }, { data: sData }, { data: iData }] = await Promise.all([
    supabase.from("physical_letters").select("*").order("letter_id"),
    supabase.from("sorting_letters_view").select("id, content_id").order("content_id"),
    supabase
      .from("inspection_letters_view")
      .select("id, content_id")
      .order("content_id"),
  ]);
  const physical = (pData ?? []) as PhysicalLetter[];
  const sortingRefs = (sData ?? []) as Pick<SortingLetterView, "id" | "content_id">[];
  const inspectionRefs = (iData ?? []) as Pick<InspectionLetterView, "id" | "content_id">[];

  const contentIdFor = (p: PhysicalLetter) => {
    if (p.content_ref_type === "sorting") {
      return sortingRefs.find((x) => x.id === p.content_ref_id)?.content_id ?? "(missing)";
    }
    return (
      inspectionRefs.find((x) => x.id === p.content_ref_id)?.content_id ?? "(missing)"
    );
  };

  return (
    <div>
      <PageHeader
        title="Physical letters"
        description="Each row = one real piece. The 6-digit letter ID is encoded into the RFID tag as SL######."
      />

      <Card className="mb-6">
        <CardContent className="pt-5">
          <form action={createPhysicalLetter} className="grid grid-cols-6 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Content type</Label>
              <Select name="content_ref_type" defaultValue="sorting">
                <option value="sorting">Sorting letter</option>
                <option value="inspection">Inspection letter</option>
              </Select>
            </div>
            <div className="col-span-3 flex flex-col gap-1.5">
              <Label>Content</Label>
              <Select name="content_ref_id" defaultValue="" required>
                <option value="" disabled>
                  Select a content letter…
                </option>
                <optgroup label="Sorting letters">
                  {sortingRefs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.content_id}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Inspection letters">
                  {inspectionRefs.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.content_id}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Storage location</Label>
              <Input name="storage_location" />
            </div>
            <div className="col-span-6 flex justify-end">
              <Button type="submit" size="sm">
                Add physical letter
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Table>
        <THead>
          <tr>
            <TH style={{ width: 100 }}>Letter ID</TH>
            <TH style={{ width: 140 }}>RFID</TH>
            <TH style={{ width: 100 }}>Type</TH>
            <TH>Content</TH>
            <TH>Storage</TH>
            <TH style={{ width: 200 }} />
          </tr>
        </THead>
        <TBody>
          {physical.map((p) => (
            <tr key={p.id}>
              <TD className="font-mono">
                {String(p.letter_id).padStart(6, "0")}
              </TD>
              <TD>
                <Badge variant="secondary" className="font-mono">
                  {p.rfid_payload}
                </Badge>
              </TD>
              <TD className="capitalize text-xs text-muted-foreground">
                {p.content_ref_type}
              </TD>
              <TD>
                <Badge variant="muted" className="font-mono">
                  {contentIdFor(p)}
                </Badge>
              </TD>
              <TD>
                <form
                  id={`phy-form-${p.id}`}
                  action={updatePhysicalLetter}
                  className="flex gap-2"
                >
                  <input type="hidden" name="id" value={p.id} />
                  <Input
                    name="storage_location"
                    defaultValue={p.storage_location ?? ""}
                    className="h-8"
                  />
                </form>
              </TD>
              <TD>
                <div className="flex justify-end gap-2">
                  <Button
                    type="submit"
                    form={`phy-form-${p.id}`}
                    size="sm"
                    variant="secondary"
                  >
                    Save
                  </Button>
                  <form action={deletePhysicalLetter}>
                    <input type="hidden" name="id" value={p.id} />
                    <Button type="submit" size="sm" variant="destructive">
                      Delete
                    </Button>
                  </form>
                </div>
              </TD>
            </tr>
          ))}
          {physical.length === 0 ? (
            <tr>
              <TD colSpan={6} className="text-center text-muted-foreground">
                No physical letters yet.
              </TD>
            </tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
