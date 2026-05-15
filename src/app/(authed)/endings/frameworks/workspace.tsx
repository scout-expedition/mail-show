"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBreadcrumbExtension } from "@/lib/breadcrumb-context";
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
import { FrameworkEditor } from "./framework-editor";
import { FrameworkList } from "./framework-list";
import {
  usePresenceContext,
  WorkspacePresenceProvider,
} from "@/lib/realtime/presence-context";
import type { PresenceProfile } from "@/lib/realtime/presence";

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
  currentUserId,
  currentEmail,
  currentProfile,
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
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="endings-frameworks"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={[
        "ending_documents",
        "ending_blocks",
        "ending_condition_rows",
        "ending_condition_row_chips",
        "ending_condition_block_variables",
      ]}
    >
      <FrameworksWorkspaceInner
        frameworks={frameworks}
        blocks={blocks}
        rows={rows}
        chips={chips}
        blockVariables={blockVariables}
        variables={variables}
        values={values}
        nations={nations}
        selectedFrameworkId={selectedFrameworkId}
        tiebreakDocsSummary={tiebreakDocsSummary}
        tiebreakDocsRaw={tiebreakDocsRaw}
      />
    </WorkspacePresenceProvider>
  );
}

function FrameworksWorkspaceInner({
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
  const { setSelection } = usePresenceContext();
  const effectiveId =
    (selectedFrameworkId &&
      frameworks.find((f) => f.id === selectedFrameworkId)?.id) ??
    frameworks[0]?.id ??
    null;
  const selected = frameworks.find((f) => f.id === effectiveId) ?? null;

  // Publish the selected framework name as a breadcrumb extension so peers
  // see "Endings > Frameworks > <Name>" in the AppPresence hover popup.
  useBreadcrumbExtension(selected?.name ? [selected.name] : []);

  // Broadcast which framework the local user is editing so RecordPresence
  // on the framework-list rows can show peer dots next to the active row.
  useEffect(() => {
    setSelection({
      storylineId: null,
      groupId: null,
      letterId: null,
      segmentId: null,
      view: "frameworks",
      payload: { endingFrameworkId: effectiveId },
    });
  }, [effectiveId, setSelection]);

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

  function navigateTo(frameworkId: string | null) {
    // Autosave + blur-flush handles in-flight writes. The 400ms debounce
    // window may swallow a quick tab switch right after a keystroke; the
    // saving-gate followup will await idle before navigating.
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
        />
      ) : (
        <div className="rounded-md border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Select or create a framework.
        </div>
      )}
    </div>
  );
}
