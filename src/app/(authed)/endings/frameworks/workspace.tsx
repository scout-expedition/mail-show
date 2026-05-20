"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBreadcrumbExtension } from "@/lib/breadcrumb-context";
import type {
  EndingBlock,
  EndingConditionBlockVariable,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingDocument,
  EndingVariable,
  EndingVariableFolder,
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
import type { PostgresChange } from "@/lib/realtime/channel";

export function FrameworksWorkspace({
  frameworks,
  blocks,
  rows,
  chips,
  blockVariables,
  variables,
  values,
  folders,
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
  folders: EndingVariableFolder[];
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
        folders={folders}
        nations={nations}
        selectedFrameworkId={selectedFrameworkId}
        tiebreakDocsSummary={tiebreakDocsSummary}
        tiebreakDocsRaw={tiebreakDocsRaw}
      />
    </WorkspacePresenceProvider>
  );
}

function FrameworksWorkspaceInner({
  frameworks: initialFrameworks,
  blocks,
  rows,
  chips,
  blockVariables,
  variables,
  values,
  folders,
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
  folders: EndingVariableFolder[];
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
  const { setSelection, onPostgresChanges } = usePresenceContext();

  // Local mirror of the framework list so name/sort_order changes echo
  // into the sidebar without a refresh. The server prop seeds initial
  // state; postgres_changes for ending_documents (framework kind only)
  // merges peer + self edits, and INSERT triggers a router.refresh()
  // so the next server render re-derives downstream tiebreak data.
  const [frameworks, setFrameworks] =
    useState<EndingDocument[]>(initialFrameworks);
  const [prevInitialFrameworks, setPrevInitialFrameworks] = useState(initialFrameworks);
  if (initialFrameworks !== prevInitialFrameworks) {
    setPrevInitialFrameworks(initialFrameworks);
    setFrameworks((prev) => {
      const prevById = new Map(prev.map((f) => [f.id, f]));
      const serverIds = new Set(initialFrameworks.map((f) => f.id));
      const kept = prev.filter((f) => serverIds.has(f.id));
      const additions = initialFrameworks.filter((f) => !prevById.has(f.id));
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table !== "ending_documents") return;
      if (change.eventType === "UPDATE" && change.new) {
        const updated = change.new as unknown as EndingDocument;
        if (updated.kind !== "framework") return;
        setFrameworks((prev) =>
          prev.map((f) => (f.id === updated.id ? { ...f, ...updated } : f))
        );
      } else if (change.eventType === "DELETE" && change.old) {
        const deleted = change.old as unknown as { id: string };
        setFrameworks((prev) => prev.filter((f) => f.id !== deleted.id));
      } else if (change.eventType === "INSERT" && change.new) {
        const inserted = change.new as unknown as EndingDocument;
        if (inserted.kind !== "framework") return;
        setFrameworks((prev) =>
          prev.some((f) => f.id === inserted.id) ? prev : [...prev, inserted]
        );
        // Trigger a re-fetch so the new framework's empty editor data
        // (blocks/rows/chips/header_vars) appears in the prop tree.
        startTransition(() => router.refresh());
      }
    });
  }, [onPostgresChanges, router]);

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
          folders={folders}
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
