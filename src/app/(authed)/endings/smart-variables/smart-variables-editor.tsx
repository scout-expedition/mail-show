"use client";

// Smart Variables editor — user-creatable docs paired 1:1 with a
// smart_ref variable. Mirrors LogicEditor in structure (one shared
// DocumentEditor per visible doc) but the document list is dynamic:
// users add/rename/delete smart variables here directly.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { slugify } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { paletteColor } from "@/lib/endings/color-palette";
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
import { makeSmartVariableResultBlock } from "../_blocks/result-block";
import { buildSmartReturnsByVariable } from "@/lib/endings/smart-variable-returns";
import {
  createSmartVariable,
  deleteSmartVariable,
  setSmartVariableColor,
} from "./actions";

export function SmartVariablesEditor(props: {
  smartDocs: EndingDocument[];
  blocks: EndingBlock[];
  rows: EndingConditionRow[];
  chips: EndingConditionRowChip[];
  blockVariables: EndingConditionBlockVariable[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  folders: EndingVariableFolder[];
  nations: Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">[];
  selectedDocId: string | null;
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="endings-smart-variables"
      userId={props.currentUserId}
      email={props.currentEmail}
      profile={props.currentProfile}
      postgresTables={[
        "ending_documents",
        "ending_blocks",
        "ending_condition_rows",
        "ending_condition_row_chips",
        "ending_condition_block_variables",
        // Live variable edits — variable picker + chip labels stay in
        // sync with renames made elsewhere (e.g. /endings/variables).
        "ending_variables",
      ]}
    >
      <SmartVariablesEditorInner {...props} />
    </WorkspacePresenceProvider>
  );
}

function SmartVariablesEditorInner({
  smartDocs: initialSmartDocs,
  blocks,
  rows,
  chips,
  blockVariables,
  variables: initialVariables,
  values,
  folders,
  nations,
  selectedDocId,
}: {
  smartDocs: EndingDocument[];
  blocks: EndingBlock[];
  rows: EndingConditionRow[];
  chips: EndingConditionRowChip[];
  blockVariables: EndingConditionBlockVariable[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  folders: EndingVariableFolder[];
  nations: Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">[];
  selectedDocId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSelection, onPostgresChanges } = usePresenceContext();

  // Local mirror of the smart-variable list so rename/sort_order edits
  // (and peer changes) echo into the sidebar without a hard refresh.
  // Mirrors the pattern in `frameworks/workspace.tsx` — the server prop
  // seeds initial state, postgres_changes merges UPDATE/DELETE, and an
  // INSERT triggers a router.refresh() so the new document's block/row/
  // chip data lands in the next server render.
  const [smartDocs, setSmartDocs] = useState<EndingDocument[]>(initialSmartDocs);
  const [prevInitialSmartDocs, setPrevInitialSmartDocs] =
    useState(initialSmartDocs);
  if (initialSmartDocs !== prevInitialSmartDocs) {
    setPrevInitialSmartDocs(initialSmartDocs);
    setSmartDocs((prev) => {
      const prevById = new Map(prev.map((d) => [d.id, d]));
      const serverIds = new Set(initialSmartDocs.map((d) => d.id));
      const kept = prev.filter((d) => serverIds.has(d.id));
      const additions = initialSmartDocs.filter((d) => !prevById.has(d.id));
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }

  // Same mirror pattern for ending_variables — color edits, renames
  // made on /endings/variables, and the doc->variable name sync trigger
  // installed in migration 20260520140000 all echo here live.
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

  // Workspace-level mirror of result + fallback blocks across EVERY
  // smart variable doc, so cross-doc references — a chip in smart
  // variable A targeting smart variable B — see B's result_value
  // edits live. The active doc's DocumentEditor still owns its own
  // per-doc mirror (for in-progress typing); this one only feeds the
  // derived `smartVariableReturns` map below.
  const initialSmartResultBlocks = useMemo(
    () =>
      blocks.filter(
        (b) => b.block_type === "result" || b.block_type === "fallback"
      ),
    [blocks]
  );
  const [smartResultBlocks, setSmartResultBlocks] = useState<EndingBlock[]>(
    initialSmartResultBlocks
  );
  const [prevInitialSmartResultBlocks, setPrevInitialSmartResultBlocks] =
    useState(initialSmartResultBlocks);
  if (initialSmartResultBlocks !== prevInitialSmartResultBlocks) {
    setPrevInitialSmartResultBlocks(initialSmartResultBlocks);
    setSmartResultBlocks((prev) => {
      const prevById = new Map(prev.map((b) => [b.id, b]));
      const serverIds = new Set(initialSmartResultBlocks.map((b) => b.id));
      const kept = prev.filter((b) => serverIds.has(b.id));
      const additions = initialSmartResultBlocks.filter(
        (b) => !prevById.has(b.id)
      );
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions];
    });
  }

  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table === "ending_documents") {
        if (change.eventType === "UPDATE" && change.new) {
          const updated = change.new as unknown as EndingDocument;
          if (updated.kind !== "smart_variable") return;
          setSmartDocs((prev) =>
            prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d))
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const deleted = change.old as unknown as { id: string };
          setSmartDocs((prev) => prev.filter((d) => d.id !== deleted.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const inserted = change.new as unknown as EndingDocument;
          if (inserted.kind !== "smart_variable") return;
          setSmartDocs((prev) =>
            prev.some((d) => d.id === inserted.id) ? prev : [...prev, inserted]
          );
          // Re-fetch so the new doc's blocks/rows/chips/header-vars +
          // paired ending_variables row land in the prop tree.
          startTransition(() => router.refresh());
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
        return;
      }
      if (change.table === "ending_blocks") {
        // Mirror smart_variable result + fallback blocks specifically,
        // so cross-doc chip dropdowns reflect edits in other smart
        // variables. The active doc's full block tree is owned by the
        // DocumentEditor's own mirror; this handler only feeds the
        // derived smartVariableReturns map. Doc-membership read through
        // the ref so a peer's "INSERT doc → INSERT block" sequence
        // doesn't drop the block because of a closure snapshot.
        const docs = smartDocsRef.current;
        if (change.eventType === "UPDATE" && change.new) {
          const n = change.new as unknown as EndingBlock;
          if (n.block_type !== "result" && n.block_type !== "fallback") return;
          setSmartResultBlocks((prev) => {
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
          setSmartResultBlocks((prev) => prev.filter((b) => b.id !== o.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const n = change.new as unknown as EndingBlock;
          if (n.block_type !== "result" && n.block_type !== "fallback") return;
          if (!docs.some((d) => d.id === n.document_id)) return;
          setSmartResultBlocks((prev) =>
            prev.some((b) => b.id === n.id) ? prev : [...prev, n]
          );
        }
      }
    });
  }, [onPostgresChanges, router]);

  // Ref mirror of smartDocs so the postgres handler above always sees
  // the latest set, even when an ending_documents INSERT for a new
  // smart variable lands in the same tick as its first block INSERT.
  const smartDocsRef = useRef(smartDocs);
  smartDocsRef.current = smartDocs;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [pendingColor, setPendingColor] = useState<{
    docId: string;
    color: string | null;
  } | null>(null);

  // Resolve which smart variable is active. Default to the first when
  // the URL doesn't carry a `?name=`, but fall back to null when the
  // list is empty (we show the empty state).
  const activeDoc = useMemo(() => {
    if (selectedDocId) {
      const found = smartDocs.find((d) => d.id === selectedDocId);
      if (found) return found;
    }
    return smartDocs[0] ?? null;
  }, [smartDocs, selectedDocId]);

  // Broadcast which smart variable the local user is editing — peers see
  // a dot next to its entry in the list.
  useEffect(() => {
    if (!activeDoc) {
      setSelection({
        storylineId: null,
        groupId: null,
        letterId: null,
        segmentId: null,
        view: "smart-variables",
        payload: { smartDocId: null },
      });
      return;
    }
    setSelection({
      storylineId: null,
      groupId: null,
      letterId: null,
      segmentId: null,
      view: "smart-variables",
      payload: { smartDocId: activeDoc.id },
    });
  }, [activeDoc, setSelection]);

  // Keep ?name= in sync when the active doc is renamed. We compare the
  // current URL param to the slug of the active doc's name; if they
  // differ we push the corrected URL. Guard: skip when no doc is active
  // (nothing to sync) and skip when no ?name= is currently set (the
  // default-first-doc case shouldn't add a param until the user clicks).
  const activeDocName = activeDoc?.name ?? null;
  useEffect(() => {
    if (!activeDocName) return;
    const currentSlug = searchParams?.get("name");
    if (!currentSlug) return; // no param — nothing to keep in sync
    const expectedSlug = slugify(activeDocName);
    if (currentSlug === expectedSlug) return;
    const qs = new URLSearchParams(searchParams?.toString() ?? "");
    qs.set("name", expectedSlug);
    router.replace(
      `/endings/smart-variables?${qs.toString()}`,
    );
  }, [activeDocName, searchParams, router]);

  // Pre-slice the per-doc block/row/chip/header arrays so the
  // DocumentEditor only sees its own document's data — same pattern as
  // LogicEditor uses for its tab switcher.
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
    for (const d of smartDocs) {
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
  }, [smartDocs, blocks, rows, chips, blockVariables]);

  // Derive from the mirrored result/fallback blocks so cross-doc
  // chip dropdowns stay live as result_value edits land — including
  // the rename propagation from patchBlock that updates referencing
  // chips. The active doc's typed-but-uncommitted result_value lives
  // in the DocumentEditor's local state and doesn't bleed back into
  // the dropdown until it commits (debounced autosave + postgres
  // echo), which is the behaviour we want.
  const smartVariableReturns = useMemo(
    () => buildSmartReturnsByVariable(smartDocs, variables, smartResultBlocks),
    [smartDocs, variables, smartResultBlocks]
  );

  // Memoized leaf component so React doesn't remount the result blocks
  // on every render. `makeSmartVariableResultBlock` is parameter-free,
  // so a single instance covers every smart_variable doc.
  const smartResultLeaf = useMemo(() => makeSmartVariableResultBlock(), []);

  // Color lookup keyed by the doc id (the list pill uses this, not the
  // paired variable directly — but the source of truth is the variable).
  const colorByDoc = useMemo(() => {
    const m = new Map<string, { color_hex: string | null; index: number }>();
    for (const v of variables) {
      if (v.kind !== "smart_ref" || !v.smart_variable_doc_id) continue;
      m.set(v.smart_variable_doc_id, {
        color_hex: v.color_hex,
        index: v.color_index,
      });
    }
    return m;
  }, [variables]);

  function navigateToDocName(docName: string | null) {
    const qs = new URLSearchParams(searchParams?.toString() ?? "");
    if (docName) qs.set("name", slugify(docName));
    else qs.delete("name");
    const search = qs.toString();
    router.push(`/endings/smart-variables${search ? `?${search}` : ""}`);
  }

  function handleCreate() {
    startTransition(async () => {
      const { name: createdName } = await createSmartVariable();
      navigateToDocName(createdName);
    });
  }

  async function handleDelete(doc: EndingDocument) {
    const ok = await confirm({
      title: `Delete "${doc.name ?? "this Smart Variable"}"?`,
      message:
        "Removes the Smart Variable and all of its blocks. Every chip in other ending documents that referenced it will also be deleted (the chip FK cascades).",
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", doc.id);
      await deleteSmartVariable(fd);
      if (activeDoc?.id === doc.id) navigateToDocName(null);
    });
  }

  function handleColorChange(docId: string, color: string | null) {
    // Track an optimistic shadow so the list pill flashes the new color
    // immediately while the server action commits.
    setPendingColor({ docId, color });
    startTransition(async () => {
      try {
        await setSmartVariableColor({ documentId: docId, color_hex: color });
      } finally {
        setPendingColor(null);
      }
    });
  }

  const activeData = activeDoc ? editorDataByDoc.get(activeDoc.id) : null;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      {confirmDialog}
      <aside className="flex w-full shrink-0 flex-col gap-2 lg:w-72">
        <div className="flex items-center justify-between px-1">
          <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            Smart Variables
          </span>
          <button
            type="button"
            onClick={handleCreate}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground disabled:opacity-50"
          >
            <Plus size={10} aria-hidden /> New
          </button>
        </div>
        {smartDocs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-[11px] text-muted-foreground">
            No Smart Variables yet. Click + New to create one.
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {smartDocs.map((doc) => {
              const active = activeDoc?.id === doc.id;
              const variableColor = colorByDoc.get(doc.id);
              const optimisticColor =
                pendingColor?.docId === doc.id ? pendingColor.color : undefined;
              const effectiveColor =
                optimisticColor !== undefined
                  ? optimisticColor ??
                    paletteColor(variableColor?.index ?? 0)
                  : variableColor?.color_hex ??
                    paletteColor(variableColor?.index ?? 0);
              return (
                <li key={doc.id}>
                  <div
                    className={cn(
                      "group flex items-center gap-2 rounded-md border px-2 py-1.5",
                      active
                        ? "border-border bg-accent/60"
                        : "border-transparent hover:bg-accent/30"
                    )}
                  >
                    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
                      <span
                        aria-hidden
                        className="h-3 w-3 rounded-full border border-border"
                        style={{ backgroundColor: effectiveColor }}
                      />
                      <input
                        type="color"
                        value={effectiveColor}
                        onChange={(e) =>
                          handleColorChange(doc.id, e.target.value)
                        }
                        aria-label={`${doc.name ?? "Smart Variable"} chip color`}
                        title="Chip color"
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                    </span>
                    <button
                      type="button"
                      onClick={() => navigateToDocName(doc.name ?? null)}
                      className={cn(
                        "flex-1 truncate text-left text-[12px]",
                        active
                          ? "text-foreground"
                          : "text-foreground/80 group-hover:text-foreground"
                      )}
                    >
                      {doc.name ?? "(unnamed)"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(doc)}
                      aria-label={`Delete ${doc.name ?? "Smart Variable"}`}
                      title="Delete"
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 size={11} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div className="flex-1 min-w-0">
        {activeDoc && activeData ? (
          <DocumentEditor
            key={activeDoc.id}
            document={activeDoc}
            blocks={activeData.blocks}
            rows={activeData.rows}
            chips={activeData.chips}
            blockVariables={activeData.blockVariables}
            variables={variables}
            values={values}
            smartVariableReturns={smartVariableReturns}
            folders={folders}
            nations={nations}
            leaves={{ result: smartResultLeaf }}
            panelTitle={activeDoc.name ?? "(unnamed)"}
            fallback={{
              options: [],
              helperText:
                "If no condition above matches, the Smart Variable resolves to this value.",
              emptyLabel: "Fallback value…",
              title: "Fallback value",
              mode: "text",
              textPlaceholder: "Fallback value…",
            }}
            deleteCopy={{
              menuLabel: "Delete Smart Variable",
              confirmTitle: `Delete "${activeDoc.name ?? "this Smart Variable"}"?`,
              confirmMessage:
                "Removes the Smart Variable and all of its blocks. Every chip in other ending documents that referenced it will also be deleted (the chip FK cascades).",
              skipServerDelete: true,
            }}
            onDeleted={() => {
              startTransition(async () => {
                const fd = new FormData();
                fd.set("id", activeDoc.id);
                await deleteSmartVariable(fd);
                navigateToDocName(null);
              });
            }}
          />
        ) : (
          <section className="flex h-40 items-center justify-center rounded-md border border-dashed border-border bg-card/40 text-sm text-muted-foreground">
            Create a Smart Variable to start editing.
          </section>
        )}
      </div>
    </div>
  );
}
