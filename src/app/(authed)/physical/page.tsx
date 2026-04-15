import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const canAdd = sortingRefs.length > 0 || inspectionRefs.length > 0;

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
        title="Physical Letters"
        description="Each row = one real piece. The 6-digit letter ID is encoded into the RFID tag as SL######."
      />

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
                    <Button type="submit" size="sm" variant="outline">
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

      <div className="mt-4 flex justify-center">
        <form action={createPhysicalLetter}>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={!canAdd}
            title={
              canAdd
                ? undefined
                : "Create a sorting or inspection letter first."
            }
          >
            + Physical letter
          </Button>
        </form>
      </div>
    </div>
  );
}
