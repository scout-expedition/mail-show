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

import { useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUnsavedDialog } from "@/components/panel";
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
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
import {
  DocumentEditor,
  type EditorHandle,
} from "../_shared/document-editor";
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
        { value: RANDOM_ALL_SENTINEL, label: "Random (any framework)" },
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
        { value: RANDOM_TIED_SENTINEL, label: "Random (between tied)" },
        {
          value: RANDOM_REMAINING_SENTINEL,
          label: "Random (between remaining)",
        },
        { value: RANDOM_ALL_SENTINEL, label: "Random (between all)" },
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
  nations: Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab") ?? null;
  const activeTab: LogicTabId = isLogicTabId(tabParam) ? tabParam : DEFAULT_TAB;

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

  // Track each visible editor's dirty state + save fn so tab switches
  // can prompt an unsaved-changes dialog. Keyed by document id.
  const editorHandlesRef = useRef<Map<string, EditorHandle>>(new Map());
  const { ask, dialog } = useUnsavedDialog();

  const registerHandleFor = useCallback(
    (docId: string) => (h: EditorHandle) => {
      editorHandlesRef.current.set(docId, h);
    },
    []
  );

  async function navigateToTab(nextTabId: LogicTabId) {
    if (nextTabId === activeTab) return;
    const dirtyHandles: EditorHandle[] = [];
    for (const handle of editorHandlesRef.current.values()) {
      if (handle.dirty) dirtyHandles.push(handle);
    }
    if (dirtyHandles.length > 0) {
      const outcome = await ask(
        "Unsaved changes",
        "There are unsaved changes on this tab. Save before switching?"
      );
      if (outcome === "cancel") return;
      if (outcome === "save") {
        try {
          for (const h of dirtyHandles) await h.save();
        } catch (e) {
          console.error(e);
          return;
        }
      }
    }
    // Drop stale handles so the next tab's editors register fresh.
    editorHandlesRef.current = new Map();
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
              nations={nations}
              leaves={{ result: resultLeaf }}
              panelTitle={panelTitle}
              registerHandle={registerHandleFor(doc.id)}
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
                  frameworks={frameworkDocs}
                  tiebreakDocs={tiebreakDocs}
                  nations={nations}
                />
              )}
            />
          );
        })}
      </div>
      {dialog}
    </div>
  );
}
