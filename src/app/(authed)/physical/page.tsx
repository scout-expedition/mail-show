import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  InspectionLetterView,
  PhysicalLetter,
  SortingLetterView,
} from "@/lib/db/types";
import { createPhysicalLetter } from "./actions";
import { PhysicalLettersEditor } from "./physical-letters-editor";

export default async function PhysicalLettersPage() {
  const supabase = await createSupabaseServerClient();
  const [{ data: pData }, { data: sData }, { data: iData }] = await Promise.all([
    supabase.from("physical_letters").select("*").order("letter_id"),
    supabase
      .from("sorting_letters_view")
      .select("id, content_id")
      .order("content_id"),
    supabase
      .from("inspection_letters_view")
      .select("id, content_id")
      .order("content_id"),
  ]);
  const physical = (pData ?? []) as PhysicalLetter[];
  const sortingRefs = (sData ?? []) as Pick<
    SortingLetterView,
    "id" | "content_id"
  >[];
  const inspectionRefs = (iData ?? []) as Pick<
    InspectionLetterView,
    "id" | "content_id"
  >[];
  const canAdd = sortingRefs.length > 0 || inspectionRefs.length > 0;

  return (
    <div>
      <PageHeader
        title="Physical Letters"
        description="Each row = one real piece. The 6-digit letter ID is encoded into the RFID tag as SL######."
      />

      <PhysicalLettersEditor
        physical={physical}
        sortingRefs={sortingRefs}
        inspectionRefs={inspectionRefs}
      />

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
