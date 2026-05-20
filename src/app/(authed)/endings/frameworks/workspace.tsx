"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
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
import { buildSmartReturnsByVariable } from "@/lib/endings/smart-variable-returns";

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
  smartVariableDocs,
  smartVariableBlocks,
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
  /** All kind='smart_variable' docs. Mirrored locally so renames/inserts
   *  echo into the per-variable returns map without a refresh. */
  smartVariableDocs: EndingDocument[];
  /** Smart variable `result` + `fallback` blocks across every smart
   *  variable doc. Mirrored locally so result_value edits flow into
   *  chip dropdowns + the chip-adder seed in real time. */
  smartVariableBlocks: EndingBlock[];
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
        // Variable name/color/sort_order edits — pulled in so the chip
        // labels + variable picker stay live across all surfaces, not
        // just the variables editor that owns the variable rows.
        "ending_variables",
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
        smartVariableDocs={smartVariableDocs}
        smartVariableBlocks={smartVariableBlocks}
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
  variables: initialVariables,
  values,
  folders,
  nations,
  selectedFrameworkId,
  smartVariableDocs: initialSmartVariableDocs,
  smartVariableBlocks: initialSmartVariableBlocks,
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
  smartVariableDocs: EndingDocument[];
  smartVariableBlocks: EndingBlock[];
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

  // Same mirror pattern for ending_variables — chip labels + the
  // variable picker read from `variables`, and a rename on the
  // /endings/variables page (or via the Smart Variables editor's
  // doc->variable name sync) should echo live without a tab switch.
  const [variables, setVariables] = useState<EndingVariable[]>(initialVariables);
  const [prevInitialVariables, setPrevInitialVariables] = useState(initialVariables);
  if (initialVariables !== prevInitialVariables) {
    setPrevInitialVariables(initialVariables);
    setVariables((prev) => {
      const prevById = new Map(prev.map((v) => [v.id, v]));
      const serverIds = new Set(initialVariables.map((v) => v.id));
      const kept = prev.filter((v) => serverIds.has(v.id));
      const additions = initialVariables.filter((v) => !prevById.has(v.id));
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }

  // Smart variable docs + their result/fallback blocks. We mirror both
  // so chip dropdowns + the chip-adder seed re-derive `smartVariableReturns`
  // live as a Smart Variable's result_value edits stream in via
  // ending_blocks postgres_changes from the smart-variables editor.
  // Without these mirrors the precomputed map would freeze at the
  // server-render snapshot and only catch up on next navigation.
  const [smartVariableDocs, setSmartVariableDocs] = useState<EndingDocument[]>(
    initialSmartVariableDocs
  );
  const [prevInitialSmartDocs, setPrevInitialSmartDocs] = useState(
    initialSmartVariableDocs
  );
  if (initialSmartVariableDocs !== prevInitialSmartDocs) {
    setPrevInitialSmartDocs(initialSmartVariableDocs);
    setSmartVariableDocs((prev) => {
      const prevById = new Map(prev.map((d) => [d.id, d]));
      const serverIds = new Set(initialSmartVariableDocs.map((d) => d.id));
      const kept = prev.filter((d) => serverIds.has(d.id));
      const additions = initialSmartVariableDocs.filter(
        (d) => !prevById.has(d.id)
      );
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }
  const [smartVariableBlocks, setSmartVariableBlocks] = useState<EndingBlock[]>(
    initialSmartVariableBlocks
  );
  const [prevInitialSmartBlocks, setPrevInitialSmartBlocks] = useState(
    initialSmartVariableBlocks
  );
  if (initialSmartVariableBlocks !== prevInitialSmartBlocks) {
    setPrevInitialSmartBlocks(initialSmartVariableBlocks);
    setSmartVariableBlocks((prev) => {
      const prevById = new Map(prev.map((b) => [b.id, b]));
      const serverIds = new Set(initialSmartVariableBlocks.map((b) => b.id));
      const kept = prev.filter((b) => serverIds.has(b.id));
      const additions = initialSmartVariableBlocks.filter(
        (b) => !prevById.has(b.id)
      );
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }

  // Keep a ref to the latest smart-variable doc set so the
  // ending_blocks postgres handler can decide doc-membership against
  // the CURRENT mirror, not the closure snapshot from when the effect
  // last ran. Without this, a peer's "INSERT doc → INSERT block"
  // sequence has a window where the block arrives before React
  // re-renders the effect with the new doc list, and the block gets
  // dropped from the returns map.
  const smartVariableDocsRef = useRef(smartVariableDocs);
  smartVariableDocsRef.current = smartVariableDocs;

  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table === "ending_documents") {
        if (change.eventType === "UPDATE" && change.new) {
          const updated = change.new as unknown as EndingDocument;
          if (updated.kind === "framework") {
            setFrameworks((prev) =>
              prev.map((f) => (f.id === updated.id ? { ...f, ...updated } : f))
            );
          } else if (updated.kind === "smart_variable") {
            setSmartVariableDocs((prev) =>
              prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d))
            );
          }
        } else if (change.eventType === "DELETE" && change.old) {
          const deleted = change.old as unknown as { id: string };
          setFrameworks((prev) => prev.filter((f) => f.id !== deleted.id));
          setSmartVariableDocs((prev) =>
            prev.filter((d) => d.id !== deleted.id)
          );
        } else if (change.eventType === "INSERT" && change.new) {
          const inserted = change.new as unknown as EndingDocument;
          if (inserted.kind === "framework") {
            setFrameworks((prev) =>
              prev.some((f) => f.id === inserted.id) ? prev : [...prev, inserted]
            );
            // Trigger a re-fetch so the new framework's empty editor data
            // (blocks/rows/chips/header_vars) appears in the prop tree.
            startTransition(() => router.refresh());
          } else if (inserted.kind === "smart_variable") {
            setSmartVariableDocs((prev) =>
              prev.some((d) => d.id === inserted.id)
                ? prev
                : [...prev, inserted]
            );
          }
        }
        return;
      }
      if (change.table === "ending_blocks") {
        // Mirror smart_variable result/fallback blocks specifically.
        // The DocumentEditor owns its own framework-block mirror; this
        // handler only feeds smartVariableReturns. Doc-membership is
        // checked via the ref so we always see the latest doc set,
        // even when the corresponding ending_documents INSERT just
        // landed in the same tick.
        const docs = smartVariableDocsRef.current;
        if (change.eventType === "UPDATE" && change.new) {
          const n = change.new as unknown as EndingBlock;
          if (n.block_type !== "result" && n.block_type !== "fallback") return;
          setSmartVariableBlocks((prev) => {
            const isSmart = docs.some((d) => d.id === n.document_id);
            if (!isSmart && !prev.some((b) => b.id === n.id)) return prev;
            const idx = prev.findIndex((b) => b.id === n.id);
            if (idx < 0) return isSmart ? [...prev, n] : prev;
            const out = prev.slice();
            out[idx] = { ...out[idx], ...n };
            return out;
          });
        } else if (change.eventType === "DELETE" && change.old) {
          const o = change.old as unknown as { id: string };
          setSmartVariableBlocks((prev) => prev.filter((b) => b.id !== o.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const n = change.new as unknown as EndingBlock;
          if (n.block_type !== "result" && n.block_type !== "fallback") return;
          if (!docs.some((d) => d.id === n.document_id)) return;
          setSmartVariableBlocks((prev) =>
            prev.some((b) => b.id === n.id) ? prev : [...prev, n]
          );
        }
        return;
      }
      if (change.table === "ending_variables") {
        if (change.eventType === "UPDATE" && change.new) {
          const updated = change.new as unknown as EndingVariable;
          setVariables((prev) =>
            prev.map((v) => (v.id === updated.id ? { ...v, ...updated } : v))
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const deleted = change.old as unknown as { id: string };
          setVariables((prev) => prev.filter((v) => v.id !== deleted.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const inserted = change.new as unknown as EndingVariable;
          setVariables((prev) =>
            prev.some((v) => v.id === inserted.id) ? prev : [...prev, inserted]
          );
        }
      }
    });
  }, [onPostgresChanges, router]);

  // Derived live map. Re-runs whenever any of the three mirrors update,
  // so chip dropdowns and the chip-adder seed always reflect the
  // current set of smart-variable returns.
  const smartVariableReturns = useMemo(
    () =>
      buildSmartReturnsByVariable(
        smartVariableDocs,
        variables,
        smartVariableBlocks
      ),
    [smartVariableDocs, variables, smartVariableBlocks]
  );

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
          smartVariableReturns={smartVariableReturns}
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
