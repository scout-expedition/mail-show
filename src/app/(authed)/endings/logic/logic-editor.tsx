"use client";

// Logic page client shell. Owns the active sub-tab (`?tab=`), routes
// between the three tabs, and renders one (or two stacked) shared
// DocumentEditor instances against the matching logic-kind documents.
//
// Tab layout:
//   - Ending Framework      → single editor for `framework_selection`.
//   - Class Affinity        → two stacked editors (Top, Bottom) for
//                             `class_affinity_top` / `class_affinity_bottom`.
//   - Nation Affinity       → ditto for nation_affinity_*.
//
// Each editor saves itself; switching tabs prompts an unsaved-changes
// dialog the same way the Frameworks workspace does between frameworks.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBreadcrumbExtension } from "@/lib/breadcrumb-context";
import {
  ENDING_DOCUMENT_KIND_LABELS,
  ENDING_LOGIC_TABS,
  type EndingLogicKind,
} from "@/lib/db/enums";
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
import { DocumentEditor } from "../_shared/document-editor";
import {
  usePresenceContext,
  WorkspacePresenceProvider,
} from "@/lib/realtime/presence-context";
import type { PostgresChange } from "@/lib/realtime/channel";
import type { PresenceProfile } from "@/lib/realtime/presence";
import { buildSmartReturnsByVariable } from "@/lib/endings/smart-variable-returns";
import { makeResultBlock } from "../_blocks/result-block";
import { LogicTabBar, type TabBarItem } from "./_components/tab-bar";
import { LogicPreviewView } from "./preview-view";
import {
  EMPTY_SELECTIONS,
  type EvalBlock,
  type EvalChip,
  type EvalInputs,
  type EvalRow,
  type EvalVariable,
} from "@/lib/endings/evaluator";
import {
  ENDING_LOGIC_RESULT_OPTIONS_BY_KIND,
  RANDOM_ALL_SENTINEL,
  RANDOM_REMAINING_SENTINEL,
  RANDOM_RESULT_SENTINEL,
  RANDOM_TIED_SENTINEL,
} from "@/lib/db/enums";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";

/**
 * Build the `fallback` prop DocumentEditor expects for a logic doc.
 * Framework_selection picks a framework UUID; the three tiebreak docs
 * pick a class/nation column or a random sentinel.
 */
function buildFallbackProp(
  kind: EndingLogicKind,
  frameworkDocs: EndingDocument[]
):
  | {
      options: { value: string; label: string }[];
      subsetFrameworks?: { value: string; label: string }[];
      subsetEnabled?: boolean;
      helperText: string;
      emptyLabel: string;
      title: string;
    }
  | undefined {
  if (kind === "framework_selection") {
    const frameworkOptions = frameworkDocs
      .filter((f) => f.kind === "framework")
      .map((f) => ({ value: f.id, label: f.name ?? "(unnamed)" }));
    return {
      options: [
        ...frameworkOptions,
        { value: RANDOM_ALL_SENTINEL, label: "Random (any)" },
      ],
      subsetFrameworks: frameworkOptions,
      subsetEnabled: true,
      helperText:
        "If nothing above resolves to a framework, return this one.",
      emptyLabel: "— pick a framework —",
      title: "Fallback ending",
    };
  }
  if (kind === "class_affinity_top") {
    const allowed = ENDING_LOGIC_RESULT_OPTIONS_BY_KIND[kind] ?? [];
    return {
      options: [
        ...allowed.map((v) => ({
          value: v,
          label: (VARIABLE_LABELS as Record<string, string>)[v] ?? v,
        })),
        // Class affinity has only 2 options, so "tied" and "all"
        // collapse to the same outcome; one Random entry suffices.
        // Legacy alias keeps existing rows working.
        { value: RANDOM_RESULT_SENTINEL, label: "Random" },
      ],
      helperText:
        "If nothing above resolves a tied class, return this winner.",
      emptyLabel: "— pick a class —",
      title: "Tiebreak Fallback",
    };
  }
  if (kind === "nation_affinity_top" || kind === "nation_affinity_bottom") {
    const allowed = ENDING_LOGIC_RESULT_OPTIONS_BY_KIND[kind] ?? [];
    return {
      options: [
        ...allowed.map((v) => ({
          value: v,
          label: (VARIABLE_LABELS as Record<string, string>)[v] ?? v,
        })),
        { value: RANDOM_REMAINING_SENTINEL, label: "Random (remaining)" },
        { value: RANDOM_TIED_SENTINEL, label: "Random (tied)" },
        { value: RANDOM_ALL_SENTINEL, label: "Random (all)" },
      ],
      helperText:
        "If nothing above resolves a tied nation, return this winner.",
      emptyLabel: "— pick a nation —",
      title:
        kind === "nation_affinity_top"
          ? "Top Tiebreak Fallback"
          : "Bottom Tiebreak Fallback",
    };
  }
  return undefined;
}

type LogicTabId = (typeof ENDING_LOGIC_TABS)[number]["id"];

const TAB_ITEMS: TabBarItem<LogicTabId>[] = ENDING_LOGIC_TABS.map((t) => ({
  id: t.id,
  label: t.label,
}));

const DEFAULT_TAB: LogicTabId = ENDING_LOGIC_TABS[0].id;

function isLogicTabId(value: string | null | undefined): value is LogicTabId {
  return ENDING_LOGIC_TABS.some((t) => t.id === value);
}

export function LogicEditor({
  logicDocs,
  frameworkDocs,
  blocks,
  rows,
  chips,
  blockVariables,
  variables,
  values,
  smartVariableDocs,
  smartVariableBlocks,
  smartVariableAllBlocks,
  smartVariableRows,
  smartVariableChips,
  folders,
  nations,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  logicDocs: EndingDocument[];
  frameworkDocs: EndingDocument[];
  blocks: EndingBlock[];
  rows: EndingConditionRow[];
  chips: EndingConditionRowChip[];
  blockVariables: EndingConditionBlockVariable[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  smartVariableDocs: EndingDocument[];
  smartVariableBlocks: EndingBlock[];
  /** All blocks (including condition blocks) for smart variable docs. */
  smartVariableAllBlocks: EndingBlock[];
  /** Condition rows belonging to smart variable docs. */
  smartVariableRows: EndingConditionRow[];
  /** Chips belonging to smart variable condition rows. */
  smartVariableChips: EndingConditionRowChip[];
  folders: EndingVariableFolder[];
  nations: Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">[];
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="endings-logic"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={[
        "ending_documents",
        "ending_blocks",
        "ending_condition_rows",
        "ending_condition_row_chips",
        "ending_condition_block_variables",
        // Live variable rename/color edits — chip labels read from
        // `variables` so this keeps the logic editor in sync with edits
        // on the Variables / Smart Variables pages.
        "ending_variables",
      ]}
    >
      <LogicEditorInner
        logicDocs={logicDocs}
        frameworkDocs={frameworkDocs}
        blocks={blocks}
        rows={rows}
        chips={chips}
        blockVariables={blockVariables}
        variables={variables}
        values={values}
        smartVariableDocs={smartVariableDocs}
        smartVariableBlocks={smartVariableBlocks}
        smartVariableAllBlocks={smartVariableAllBlocks}
        smartVariableRows={smartVariableRows}
        smartVariableChips={smartVariableChips}
        folders={folders}
        nations={nations}
      />
    </WorkspacePresenceProvider>
  );
}

function LogicEditorInner({
  logicDocs,
  frameworkDocs,
  blocks,
  rows,
  chips,
  blockVariables,
  variables: initialVariables,
  values,
  smartVariableDocs: initialSmartVariableDocs,
  smartVariableBlocks: initialSmartVariableBlocks,
  smartVariableAllBlocks,
  smartVariableRows,
  smartVariableChips,
  folders,
  nations,
}: {
  logicDocs: EndingDocument[];
  frameworkDocs: EndingDocument[];
  blocks: EndingBlock[];
  rows: EndingConditionRow[];
  chips: EndingConditionRowChip[];
  blockVariables: EndingConditionBlockVariable[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  smartVariableDocs: EndingDocument[];
  smartVariableBlocks: EndingBlock[];
  smartVariableAllBlocks: EndingBlock[];
  smartVariableRows: EndingConditionRow[];
  smartVariableChips: EndingConditionRowChip[];
  folders: EndingVariableFolder[];
  nations: Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSelection, peers, onPostgresChanges } = usePresenceContext();

  // Local mirror of ending_variables so renames/color edits made on
  // other surfaces (the Variables page; the Smart Variables editor's
  // doc->variable name sync) echo live into chip labels here without a
  // refresh. Mirrors the frameworks workspace pattern.
  const [variables, setVariables] =
    useState<EndingVariable[]>(initialVariables);
  const [prevInitialVariables, setPrevInitialVariables] =
    useState(initialVariables);
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

  // Smart variable docs + their result/fallback blocks — mirrored so
  // chip dropdowns inside the logic editor stay live as the
  // smart-variables surface edits result_values.
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

  // Same ref pattern frameworks/workspace.tsx uses — the ending_blocks
  // postgres handler reads `smartVariableDocs` through the ref so it
  // always sees the latest doc set without resubscribing the effect.
  const smartVariableDocsRef = useRef(smartVariableDocs);
  useEffect(() => {
    smartVariableDocsRef.current = smartVariableDocs;
  }, [smartVariableDocs]);

  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
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
        return;
      }
      if (change.table === "ending_documents") {
        if (change.eventType === "UPDATE" && change.new) {
          const updated = change.new as unknown as EndingDocument;
          if (updated.kind !== "smart_variable") return;
          setSmartVariableDocs((prev) =>
            prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d))
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const deleted = change.old as unknown as { id: string };
          setSmartVariableDocs((prev) =>
            prev.filter((d) => d.id !== deleted.id)
          );
        } else if (change.eventType === "INSERT" && change.new) {
          const inserted = change.new as unknown as EndingDocument;
          if (inserted.kind !== "smart_variable") return;
          setSmartVariableDocs((prev) =>
            prev.some((d) => d.id === inserted.id)
              ? prev
              : [...prev, inserted]
          );
        }
        return;
      }
      if (change.table === "ending_blocks") {
        // Smart-variable result/fallback only — the LogicEditor's own
        // editor data is owned by DocumentEditor, which has its own
        // per-doc mirror. Doc-membership read through the ref so a
        // peer's "INSERT doc → INSERT block" sequence doesn't drop
        // the block because of a closure snapshot.
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
      }
    });
  }, [onPostgresChanges]);

  const smartVariableReturns = useMemo(
    () =>
      buildSmartReturnsByVariable(
        smartVariableDocs,
        variables,
        smartVariableBlocks
      ),
    [smartVariableDocs, variables, smartVariableBlocks]
  );

  // Maps smart_ref variable id → smart_variable_doc_id. Built from
  // EndingVariable (which has smart_variable_doc_id) so the preview view
  // doesn't need to reach into VariableState for that field.
  const smartVarDocIdByVariableId = useMemo((): Map<string, string> => {
    const out = new Map<string, string>();
    for (const v of variables) {
      if (v.kind === "smart_ref" && v.smart_variable_doc_id) {
        out.set(v.id, v.smart_variable_doc_id);
      }
    }
    return out;
  }, [variables]);

  // Per-smart-variable-doc EvalInputs for the preview's "Set inputs" path.
  // Built from the static server snapshot (rows/chips don't change in real
  // time on this surface). Keyed by smart_variable_doc_id.
  const smartVariableEvalInputsByDocId = useMemo((): Map<string, EvalInputs> => {
    const evalVariables: EvalVariable[] = variables.map((v) => ({
      id: v.id,
      name: v.name,
      kind: v.kind,
      aggregate_ref: (v.aggregate_ref ?? null) as EvalVariable["aggregate_ref"],
    }));
    const numberRefByName = new Map<string, string>();
    for (const v of variables) {
      if (v.kind === "number_ref" && v.number_ref) {
        numberRefByName.set(v.number_ref, v.id);
      }
    }
    const out = new Map<string, EvalInputs>();
    for (const doc of smartVariableDocs) {
      const docBlocks = smartVariableAllBlocks.filter(
        (b) => b.document_id === doc.id
      );
      const blockIds = new Set(docBlocks.map((b) => b.id));
      const docRows = smartVariableRows.filter((r) =>
        blockIds.has(r.condition_block_id)
      );
      const rowIds = new Set(docRows.map((r) => r.id));
      const docChips = smartVariableChips.filter((c) => rowIds.has(c.row_id));
      out.set(doc.id, {
        blocks: docBlocks as unknown as EvalBlock[],
        rows: docRows as unknown as EvalRow[],
        chips: docChips as unknown as EvalChip[],
        variables: evalVariables,
        selections: { ...EMPTY_SELECTIONS, numberRefByName },
      });
    }
    return out;
  }, [
    smartVariableDocs,
    smartVariableAllBlocks,
    smartVariableRows,
    smartVariableChips,
    variables,
  ]);

  const tabParam = searchParams?.get("tab") ?? null;
  const activeTab: LogicTabId = isLogicTabId(tabParam) ? tabParam : DEFAULT_TAB;

  // Broadcast which logic tab the local user is editing. Peers in a
  // different tab still appear in the global avatar stack; the tab-bar
  // dots show who's currently on which tab specifically.
  useEffect(() => {
    setSelection({
      storylineId: null,
      groupId: null,
      letterId: null,
      segmentId: null,
      view: "logic",
      payload: { endingTabId: activeTab },
    });
  }, [activeTab, setSelection]);

  // Index logic docs by kind for fast lookup. Each kind is a singleton
  // by partial unique index so the first match is the only match.
  const docsByKind = useMemo(() => {
    const m = new Map<EndingLogicKind, EndingDocument>();
    for (const d of logicDocs) {
      m.set(d.kind as EndingLogicKind, d);
    }
    return m;
  }, [logicDocs]);

  // Filter the per-doc slices once so each editor receives stable
  // references — matches the FrameworksWorkspace memo pattern, same
  // reason: avoid the editor's reconcile effect retriggering each tick.
  const editorDataByDoc = useMemo(() => {
    const out = new Map<
      string,
      {
        blocks: EndingBlock[];
        rows: EndingConditionRow[];
        chips: EndingConditionRowChip[];
        blockVariables: EndingConditionBlockVariable[];
      }
    >();
    for (const d of logicDocs) {
      const docBlocks = blocks.filter((b) => b.document_id === d.id);
      const blockIds = new Set(docBlocks.map((b) => b.id));
      const docRows = rows.filter((r) => blockIds.has(r.condition_block_id));
      const rowIds = new Set(docRows.map((r) => r.id));
      const docChips = chips.filter((c) => rowIds.has(c.row_id));
      const docHeaderVars = blockVariables.filter((bv) =>
        blockIds.has(bv.condition_block_id)
      );
      out.set(d.id, {
        blocks: docBlocks,
        rows: docRows,
        chips: docChips,
        blockVariables: docHeaderVars,
      });
    }
    return out;
  }, [logicDocs, blocks, rows, chips, blockVariables]);

  // Pre-build a ResultBlock component per kind (so the BlockList's leaf
  // dispatch resolves to a kind-aware Select). Memoized so identity is
  // stable across renders — the editor uses these as React component
  // identities and would remount its leaves each render otherwise.
  const resultBlockByKind = useMemo(() => {
    const m = new Map<EndingLogicKind, ReturnType<typeof makeResultBlock>>();
    for (const d of logicDocs) {
      const k = d.kind as EndingLogicKind;
      if (!m.has(k)) m.set(k, makeResultBlock(k, frameworkDocs));
    }
    return m;
  }, [logicDocs, frameworkDocs]);

  // Saved-state EvalInputs per logic kind. Used by the framework_selection
  // preview so aggregate chips that reference class/nation affinity can
  // resolve through the saved tiebreak rules. Unsaved tiebreak edits in
  // a different tab don't reach this map until saved — call out in the
  // preview UI if needed (followup).
  const evalVariablesAll = useMemo(
    (): EvalVariable[] =>
      variables.map(
        (v): EvalVariable => ({
          id: v.id,
          name: v.name,
          kind: v.kind,
          aggregate_ref: (v.aggregate_ref ?? null) as EvalVariable["aggregate_ref"],
        })
      ),
    [variables]
  );
  const tiebreakDocs = useMemo(() => {
    const numberRefByName = new Map<string, string>();
    for (const v of variables) {
      if (v.kind === "number_ref" && v.number_ref) {
        numberRefByName.set(v.number_ref, v.id);
      }
    }
    const m = new Map<EndingLogicKind, EvalInputs>();
    for (const d of logicDocs) {
      const data = editorDataByDoc.get(d.id);
      if (!data) continue;
      m.set(d.kind as EndingLogicKind, {
        blocks: data.blocks as unknown as EvalBlock[],
        rows: data.rows as unknown as EvalRow[],
        chips: data.chips as unknown as EvalChip[],
        variables: evalVariablesAll,
        selections: { ...EMPTY_SELECTIONS, numberRefByName },
      });
    }
    return m;
  }, [logicDocs, editorDataByDoc, variables, evalVariablesAll]);

  // Per-logic-kind tiebreak summary for the static analyzer. Same
  // shape FrameworksWorkspace builds in frameworks/page.tsx — a doc
  // is empty only when it has zero rows AND no fallback value set.
  const tiebreakDocsSummary = useMemo(() => {
    const m = new Map<EndingLogicKind, { isEmpty: boolean }>();
    for (const d of logicDocs) {
      const data = editorDataByDoc.get(d.id);
      const hasRow = (data?.rows.length ?? 0) > 0;
      const fallback = data?.blocks.find((b) => b.block_type === "fallback");
      const fallbackSet =
        fallback?.result_value != null && fallback.result_value !== "";
      m.set(d.kind as EndingLogicKind, {
        isEmpty: !hasRow && !fallbackSet,
      });
    }
    return m;
  }, [logicDocs, editorDataByDoc]);

  function navigateToTab(nextTabId: LogicTabId) {
    if (nextTabId === activeTab) return;
    // Autosave + blur-flush handles in-flight writes. The 400ms debounce
    // window may swallow a quick tab switch right after a keystroke; the
    // saving-gate followup will await idle before navigating.
    const qs = new URLSearchParams(searchParams?.toString() ?? "");
    qs.set("tab", nextTabId);
    router.push(`/endings/logic?${qs.toString()}`);
  }

  const activeTabConfig = ENDING_LOGIC_TABS.find((t) => t.id === activeTab)!;

  useBreadcrumbExtension([activeTabConfig.label]);

  return (
    <div className="flex flex-col gap-3">
      <LogicTabBar
        tabs={TAB_ITEMS}
        activeId={activeTab}
        onSelect={(id) => {
          void navigateToTab(id);
        }}
        renderTrailing={(tabId) => {
          const peersOnTab = peers.filter(
            (p) => p.selection?.payload?.endingTabId === tabId
          );
          if (peersOnTab.length === 0) return null;
          const visible = peersOnTab.slice(0, 3);
          const overflow = peersOnTab.length - visible.length;
          return (
            <span
              className="inline-flex items-center gap-0.5"
              aria-label={
                peersOnTab.length === 1
                  ? `${peersOnTab[0].email} is on this tab`
                  : `${peersOnTab.length} others on this tab`
              }
            >
              {visible.map((peer) => (
                <span
                  key={peer.userId}
                  className="rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor:
                      peer.profile?.avatarColorHex ?? peer.color,
                  }}
                  title={peer.email}
                />
              ))}
              {overflow > 0 ? (
                <span className="text-[9px] tabular-nums">
                  +{overflow}
                </span>
              ) : null}
            </span>
          );
        }}
      />

      <div className="flex flex-col gap-4">
        {activeTabConfig.kinds.map((kind) => {
          const doc = docsByKind.get(kind);
          if (!doc) {
            return (
              <section
                key={kind}
                className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-6 text-center text-sm text-destructive"
              >
                Missing seeded document for kind <code>{kind}</code>. Re-run
                migrations or contact an admin.
              </section>
            );
          }
          const data = editorDataByDoc.get(doc.id);
          if (!data) return null;
          const resultLeaf = resultBlockByKind.get(kind);
          const panelTitle = ENDING_DOCUMENT_KIND_LABELS[kind];
          const fallback = buildFallbackProp(kind, frameworkDocs);
          return (
            <DocumentEditor
              key={doc.id}
              document={doc}
              blocks={data.blocks}
              rows={data.rows}
              chips={data.chips}
              blockVariables={data.blockVariables}
              variables={variables}
              values={values}
              smartVariableReturns={smartVariableReturns}
              folders={folders}
              nations={nations}
              leaves={{ result: resultLeaf }}
              panelTitle={panelTitle}
              fallback={fallback}
              tiebreakDocsSummary={tiebreakDocsSummary}
              renderPreview={(args) => (
                <LogicPreviewView
                  docKind={kind}
                  blocks={args.blocks}
                  rows={args.rows}
                  chips={args.chips}
                  variables={args.variables}
                  referencedVariables={args.referencedVariables}
                  values={args.values}
                  selections={args.selections}
                  onChangeText={args.onChangeText}
                  onChangeNumber={args.onChangeNumber}
                  flashColors={args.flashColors}
                  frameworks={frameworkDocs}
                  tiebreakDocs={tiebreakDocs}
                  nations={nations}
                  smartVariableDocs={smartVariableDocs}
                  smartVariableReturns={smartVariableReturns}
                  smartVariableEvalInputsByDocId={smartVariableEvalInputsByDocId}
                  smartVarDocIdByVariableId={smartVarDocIdByVariableId}
                />
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
