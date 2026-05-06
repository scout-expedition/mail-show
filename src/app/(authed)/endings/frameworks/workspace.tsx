"use client";

import { useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUnsavedDialog } from "@/components/panel";
import type {
  EndingBlock,
  EndingConditionBlockVariable,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingDocument,
  EndingVariable,
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
import type { EditorHandle } from "../_shared/document-editor";
import { FrameworkEditor } from "./framework-editor";
import { FrameworkList } from "./framework-list";

export function FrameworksWorkspace({
  frameworks,
  blocks,
  rows,
  chips,
  blockVariables,
  variables,
  values,
  nations,
  selectedFrameworkId,
  tiebreakDocsSummary,
  tiebreakDocsRaw,
}: {
  frameworks: EndingDocument[];
  blocks: EndingBlock[];
  rows: EndingConditionRow[];
  chips: EndingConditionRowChip[];
  blockVariables: EndingConditionBlockVariable[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  nations: Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">[];
  selectedFrameworkId: string | null;
  tiebreakDocsSummary: Map<
    import("@/lib/db/enums").EndingLogicKind,
    { isEmpty: boolean }
  >;
  tiebreakDocsRaw: Map<
    import("@/lib/db/enums").EndingLogicKind,
    {
      blocks: EndingBlock[];
      rows: EndingConditionRow[];
      chips: EndingConditionRowChip[];
    }
  >;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const effectiveId =
    (selectedFrameworkId &&
      frameworks.find((f) => f.id === selectedFrameworkId)?.id) ??
    frameworks[0]?.id ??
    null;
  const selected = frameworks.find((f) => f.id === effectiveId) ?? null;

  // Filter once per (selected, blocks/rows/chips) change. Without memoization
  // these `.filter()` calls produce new arrays every render, which makes the
  // editor's reconcile effect think the server data changed every tick — a
  // classic infinite-render trap.
  const editorData = useMemo(() => {
    if (!selected) return null;
    const editorBlocks = blocks.filter((b) => b.document_id === selected.id);
    const blockIds = new Set(editorBlocks.map((b) => b.id));
    const editorRows = rows.filter((r) => blockIds.has(r.condition_block_id));
    const rowIds = new Set(editorRows.map((r) => r.id));
    const editorChips = chips.filter((c) => rowIds.has(c.row_id));
    const editorBlockVariables = blockVariables.filter((bv) =>
      blockIds.has(bv.condition_block_id)
    );
    return { editorBlocks, editorRows, editorChips, editorBlockVariables };
  }, [selected, blocks, rows, chips, blockVariables]);

  const editorHandleRef = useRef<EditorHandle>({
    dirty: false,
    save: async () => {},
  });
  const { ask, dialog } = useUnsavedDialog();

  async function navigateTo(frameworkId: string | null) {
    if (editorHandleRef.current.dirty) {
      const outcome = await ask(
        "Unsaved changes",
        "This framework has unsaved changes. Save before switching?"
      );
      if (outcome === "cancel") return;
      if (outcome === "save") {
        try {
          await editorHandleRef.current.save();
        } catch (e) {
          console.error(e);
          return;
        }
      }
    }
    const qs = new URLSearchParams(searchParams?.toString() ?? "");
    if (frameworkId) qs.set("framework", frameworkId);
    else qs.delete("framework");
    const suffix = qs.toString();
    router.push(`/endings/frameworks${suffix ? `?${suffix}` : ""}`);
  }

  return (
    <div className="grid gap-3 md:grid-cols-[240px_1fr]">
      <FrameworkList
        frameworks={frameworks}
        selectedId={effectiveId}
        onSelect={navigateTo}
      />

      {selected && editorData ? (
        <FrameworkEditor
          key={selected.id}
          framework={selected}
          blocks={editorData.editorBlocks}
          rows={editorData.editorRows}
          chips={editorData.editorChips}
          blockVariables={editorData.editorBlockVariables}
          variables={variables}
          values={values}
          nations={nations}
          tiebreakDocsSummary={tiebreakDocsSummary}
          tiebreakDocsRaw={tiebreakDocsRaw}
          onDeleted={() => navigateTo(null)}
          registerHandle={(h) => {
            editorHandleRef.current = h;
          }}
        />
      ) : (
        <div className="rounded-md border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Select or create a framework.
        </div>
      )}
      {dialog}
    </div>
  );
}
