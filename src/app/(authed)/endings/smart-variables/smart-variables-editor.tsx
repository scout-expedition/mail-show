"use client";

// Smart Variables editor — user-creatable docs paired 1:1 with a
// smart_ref variable. Mirrors LogicEditor in structure (one shared
// DocumentEditor per visible doc) but the document list is dynamic:
// users add/rename/delete smart variables here directly.

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Atom, Plus } from "lucide-react";
import { paletteColor } from "@/lib/endings/color-palette";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import {
  isValidFolderDropTarget,
  type FolderLike,
} from "@/lib/endings/folder-drag";
import { useLocalStorage } from "@/lib/use-local-storage";
import { PanelHeader } from "@/components/panel";
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
  createSmartVariableFolder,
  deleteSmartVariable,
  deleteSmartVariableFolder,
  moveSmartVariableFolder,
  moveSmartVariableToFolder,
  renameSmartVariable,
  renameSmartVariableFolder,
  setSmartVariableColor,
} from "./actions";
import {
  DragProvider,
  FolderTreeView,
  type DragContextValue,
  type DragSource,
  type DragTarget,
  type SelectOptions,
} from "../_shared/folder-tree-view";

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
        // Folder edits — the smart-variables tree subscribes so create
        // / rename / move / delete from peers reflect immediately.
        "ending_variable_folders",
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
  folders: initialFolders,
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
  const { toast, toaster } = useToast();

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

  // Folder mirror — both scopes load up-front; the rail filters to
  // 'smart_variable' below, the DocumentEditor (via the
  // `regularFolders` slice) consumes 'variable' folders for the
  // create-variable-popover.
  const [folders, setFolders] = useState<EndingVariableFolder[]>(initialFolders);
  const [prevInitialFolders, setPrevInitialFolders] = useState(initialFolders);
  if (initialFolders !== prevInitialFolders) {
    setPrevInitialFolders(initialFolders);
    setFolders((prev) => {
      const prevById = new Map(prev.map((f) => [f.id, f]));
      const serverIds = new Set(initialFolders.map((f) => f.id));
      const kept = prev.filter((f) => serverIds.has(f.id));
      const additions = initialFolders.filter((f) => !prevById.has(f.id));
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
        return;
      }
      if (change.table === "ending_variable_folders") {
        if (change.eventType === "UPDATE" && change.new) {
          const f = change.new as unknown as EndingVariableFolder;
          setFolders((prev) =>
            prev.map((r) => (r.id === f.id ? { ...r, ...f } : r))
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const o = change.old as unknown as { id: string };
          setFolders((prev) => prev.filter((r) => r.id !== o.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const f = change.new as unknown as EndingVariableFolder;
          setFolders((prev) =>
            prev.some((r) => r.id === f.id) ? prev : [...prev, f]
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
  const [pending, runTransition] = useTransition();

  // Resolve which smart variable is active. Default to the first when
  // the URL doesn't carry a `?doc=`, but fall back to null when the
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

  // Partition folders by scope. The rail tree shows 'smart_variable'
  // folders only; the DocumentEditor's create-variable-popover needs
  // 'variable' folders (regular text variables created inline inside
  // chips live in the regular-variable scope).
  const smartFolders = useMemo(
    () => folders.filter((f) => f.scope === "smart_variable"),
    [folders]
  );
  const regularFolders = useMemo(
    () => folders.filter((f) => f.scope === "variable"),
    [folders]
  );

  // Smart-ref variables (the rail's leaf rows).
  const smartVariables = useMemo(
    () => variables.filter((v) => v.kind === "smart_ref"),
    [variables]
  );
  // Map smart-ref variable id → its paired document for navigation on
  // single-select. Built once from variables since smart_variable_doc_id
  // is invariant after creation.
  const docByVariableId = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of smartVariables) {
      if (v.smart_variable_doc_id) m.set(v.id, v.smart_variable_doc_id);
    }
    return m;
  }, [smartVariables]);

  // Tree-shaped reads consumed by FolderTreeView. Smart Variables sort
  // strictly alphabetically (case-insensitive) at every nesting level —
  // sort_order writes from drag-to-move are still preserved server-side
  // but ignored for display. The id tie-break keeps the order stable
  // when two siblings happen to share a name.
  const childFoldersByParent = useMemo(() => {
    const m = new Map<string | null, EndingVariableFolder[]>();
    for (const f of smartFolders) {
      const key = f.parent_folder_id ?? null;
      const list = m.get(key) ?? [];
      list.push(f);
      m.set(key, list);
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
          a.id.localeCompare(b.id)
      );
    }
    return m;
  }, [smartFolders]);
  const sortedVariablesByFolder = useMemo(() => {
    const m = new Map<string | null, EndingVariable[]>();
    for (const v of smartVariables) {
      const key = v.folder_id ?? null;
      const list = m.get(key) ?? [];
      list.push(v);
      m.set(key, list);
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
          a.id.localeCompare(b.id)
      );
    }
    return m;
  }, [smartVariables]);

  // Collapse state — same pattern as variables-editor (mode + per-id
  // override). Persisted in localStorage so the rail remembers state.
  const [collapseMode] = useLocalStorage<"expanded" | "collapsed">(
    "smart-variables.collapseMode",
    "expanded"
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  function isCollapsedKey(key: string): boolean {
    const overridden = collapsedIds.has(key);
    return collapseMode === "collapsed" ? !overridden : overridden;
  }
  function toggleCollapsed(key: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Selection: ?doc=<id> (smart variable) | ?folder=<id> (folder).
  // Tree multi-select via shift+click extends `selectedIds`; URL only
  // syncs single-selection.
  const initialSelectedIds = useMemo(() => {
    const f = searchParams.get("folder");
    if (f) return new Set([f]);
    if (selectedDocId) {
      const variable = smartVariables.find(
        (v) => v.smart_variable_doc_id === selectedDocId
      );
      if (variable) return new Set([variable.id]);
    }
    return new Set<string>();
  }, [searchParams, selectedDocId, smartVariables]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialSelectedIds);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  const syncUrl = useCallback(
    (ids: Set<string>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("folder");
      if (ids.size === 1) {
        const [only] = Array.from(ids);
        if (smartFolders.some((f) => f.id === only)) {
          params.set("folder", only);
          params.delete("doc");
        } else {
          const docId = docByVariableId.get(only);
          if (docId) params.set("doc", docId);
          else params.delete("doc");
        }
      }
      const qs = params.toString();
      router.replace(`/endings/smart-variables${qs ? `?${qs}` : ""}`, {
        scroll: false,
      });
    },
    [searchParams, router, smartFolders, docByVariableId]
  );

  const handleSelect = useCallback(
    (id: string, opts?: SelectOptions) => {
      // Functional updater so rapid clicks (16ms apart) compose
      // correctly — closing over the latest `selectedIds` would race
      // because both clicks would start from the pre-first-click set.
      // URL sync runs in the useEffect below, keyed on selectedIds.
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (opts?.extend) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          next.clear();
          next.add(id);
        }
        return next;
      });
    },
    []
  );

  // Mirror `selectedIds` to the URL via an effect — keeps the
  // router.replace OUT of React's commit phase (Next 16 throws "Cannot
  // update during render" otherwise, which silently breaks the
  // surrounding click → dragstart event sequence). Initial selection
  // (parsed from the URL on mount) re-writes a no-op URL on first
  // commit, which is harmless.
  useEffect(() => {
    syncUrl(selectedIds);
  }, [selectedIds, syncUrl]);

  function navigateToDoc(docId: string | null) {
    const qs = new URLSearchParams(searchParams?.toString() ?? "");
    if (docId) qs.set("doc", docId);
    else qs.delete("doc");
    const search = qs.toString();
    router.push(`/endings/smart-variables${search ? `?${search}` : ""}`);
  }

  // ── Create / rename / delete ─────────────────────────────────────────
  function handleCreateSmartVariable() {
    // Default destination: the folder the user has selected (or the
    // folder containing the selected variable). null = root.
    let folderId: string | null = null;
    if (selectedIds.size === 1) {
      const [only] = Array.from(selectedIds);
      if (smartFolders.some((f) => f.id === only)) folderId = only;
      else
        folderId =
          smartVariables.find((v) => v.id === only)?.folder_id ?? null;
    }
    runTransition(async () => {
      try {
        const { documentId, variableId } = await createSmartVariable({
          folderId,
        });
        // Mark the new variable as the single selection AND navigate.
        const next = new Set([variableId]);
        setSelectedIds(next);
        const params = new URLSearchParams(searchParams.toString());
        params.delete("folder");
        params.set("doc", documentId);
        router.push(`/endings/smart-variables?${params.toString()}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Create failed.";
        toast({ message: msg, intent: "destructive" });
      }
    });
  }

  function handleCreateFolder() {
    // Mint the id client-side so we can optimistically insert the row
    // and pin it on top while the server resolves.
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "00000000-0000-4000-8000-000000000000".replace(/[0]/g, () =>
            Math.floor(Math.random() * 16).toString(16)
          );
    let parentId: string | null = null;
    if (selectedIds.size === 1) {
      const [only] = Array.from(selectedIds);
      if (smartFolders.some((f) => f.id === only)) parentId = only;
      else
        parentId =
          smartVariables.find((v) => v.id === only)?.folder_id ?? null;
    }
    const siblings = smartFolders.filter(
      (f) => (f.parent_folder_id ?? null) === parentId
    );
    const nextSort =
      siblings.reduce((m, f) => Math.max(m, f.sort_order), 0) + 1;
    const now = new Date().toISOString();
    const optimistic: EndingVariableFolder = {
      id,
      name: "New folder",
      parent_folder_id: parentId,
      sort_order: nextSort,
      scope: "smart_variable",
      created_at: now,
      updated_at: now,
    };
    setFolders((prev) => [...prev, optimistic]);
    setPinnedId(id);
    setSelectedIds(new Set([id]));
    void (async () => {
      try {
        await createSmartVariableFolder({ id, parentFolderId: parentId });
      } catch (err) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        setPinnedId((cur) => (cur === id ? null : cur));
        const msg = err instanceof Error ? err.message : "Create failed.";
        toast({ message: msg, intent: "destructive" });
      }
    })();
  }

  function handleRenameVariable(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const variable = smartVariables.find((v) => v.id === id);
    if (!variable?.smart_variable_doc_id) return;
    setVariables((prev) =>
      prev.map((v) => (v.id === id ? { ...v, name: trimmed } : v))
    );
    void (async () => {
      try {
        await renameSmartVariable({
          documentId: variable.smart_variable_doc_id!,
          name: trimmed,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Rename failed.";
        toast({ message: msg, intent: "destructive" });
        startTransition(() => router.refresh());
      }
    })();
  }

  function handleRenameFolder(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
    );
    void (async () => {
      try {
        await renameSmartVariableFolder({ id, name: trimmed });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Rename failed.";
        toast({ message: msg, intent: "destructive" });
        startTransition(() => router.refresh());
      }
    })();
  }

  async function handleDeleteFolder(id: string) {
    const folder = smartFolders.find((f) => f.id === id);
    const ok = await confirm({
      title: `Delete "${folder?.name ?? "folder"}"?`,
      message:
        "The folder must be empty. Child folders and smart variables fall back to its parent when present, otherwise to root.",
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    runTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("id", id);
        await deleteSmartVariableFolder(fd);
        setSelectedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed.";
        toast({ message: msg, intent: "destructive" });
      }
    });
  }

  // ── Drag-and-drop ────────────────────────────────────────────────────
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);

  const dragStart = useCallback((source: DragSource) => {
    setDragSource(source);
    setDragTarget(null);
  }, []);
  const dragEnd = useCallback(() => {
    setDragSource(null);
    setDragTarget(null);
  }, []);

  // Folder-cycle FolderLike list — declared up here so the drag context
  // closure captures the latest.
  const foldersForCycle = useMemo<FolderLike[]>(
    () =>
      smartFolders.map((f) => ({
        id: f.id,
        parent_folder_id: f.parent_folder_id,
      })),
    [smartFolders]
  );

  const commitDrop = useCallback(async (): Promise<boolean> => {
    const source = dragSource;
    const target = dragTarget;
    if (!source || !target) return false;
    if (source.id === target.before_id) return false;
    if (source.kind === "variable") {
      const variable = smartVariables.find((v) => v.id === source.id);
      if (!variable) return false;
      // Same-folder drag is a no-op — the rail renders alphabetically,
      // so within-folder reorders have no visible effect.
      if ((variable.folder_id ?? null) === target.parent_folder_id) {
        return false;
      }
      setVariables((prev) => {
        const moved = prev.find((v) => v.id === source.id);
        if (!moved) return prev;
        const updated: EndingVariable = {
          ...moved,
          folder_id: target.parent_folder_id,
        };
        const without = prev.filter((v) => v.id !== source.id);
        const idx = target.before_id
          ? without.findIndex((v) => v.id === target.before_id)
          : -1;
        if (idx < 0) return [...without, updated];
        return [...without.slice(0, idx), updated, ...without.slice(idx)];
      });
      try {
        await moveSmartVariableToFolder({
          variableId: source.id,
          folderId: target.parent_folder_id,
          beforeId: target.before_id,
        });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Move failed.";
        toast({ message: msg, intent: "destructive" });
        startTransition(() => router.refresh());
        return false;
      }
    }
    // Folder
    if (
      !isValidFolderDropTarget(
        foldersForCycle,
        source.id,
        target.parent_folder_id
      )
    ) {
      toast({
        message: "Can't move a folder into itself or a descendant.",
        intent: "destructive",
      });
      return false;
    }
    setFolders((prev) => {
      const moved = prev.find((f) => f.id === source.id);
      if (!moved) return prev;
      const updated: EndingVariableFolder = {
        ...moved,
        parent_folder_id: target.parent_folder_id,
      };
      const without = prev.filter((f) => f.id !== source.id);
      const idx = target.before_id
        ? without.findIndex((f) => f.id === target.before_id)
        : -1;
      if (idx < 0) return [...without, updated];
      return [...without.slice(0, idx), updated, ...without.slice(idx)];
    });
    try {
      await moveSmartVariableFolder({
        folderId: source.id,
        parentFolderId: target.parent_folder_id,
        beforeId: target.before_id,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Move failed.";
      toast({ message: msg, intent: "destructive" });
      startTransition(() => router.refresh());
      return false;
    }
  }, [
    dragSource,
    dragTarget,
    smartVariables,
    foldersForCycle,
    router,
    toast,
  ]);

  const dragValue = useMemo<DragContextValue>(
    () => ({
      source: dragSource,
      target: dragTarget,
      start: dragStart,
      proposeTarget: (target: DragTarget) => {
        if (!dragSource) return false;
        if (target.before_id === dragSource.id) return false;
        if (
          dragSource.kind === "folder" &&
          !isValidFolderDropTarget(
            foldersForCycle,
            dragSource.id,
            target.parent_folder_id
          )
        ) {
          return false;
        }
        setDragTarget((prev) => {
          if (
            prev &&
            prev.parent_folder_id === target.parent_folder_id &&
            prev.before_id === target.before_id &&
            prev.intoFolder === target.intoFolder
          ) {
            return prev;
          }
          return target;
        });
        return true;
      },
      clearTarget: () => setDragTarget(null),
      end: dragEnd,
    }),
    [dragSource, dragTarget, dragStart, dragEnd, foldersForCycle]
  );

  const activeData = activeDoc ? editorDataByDoc.get(activeDoc.id) : null;

  // Single-selection folder (used for the rail's contextual delete
  // button). Variables are deleted via the right-pane DocumentEditor.
  const singleSelectedFolderId =
    selectedIds.size === 1 ? Array.from(selectedIds)[0] : null;
  const singleSelectedFolder =
    singleSelectedFolderId
      ? smartFolders.find((f) => f.id === singleSelectedFolderId) ?? null
      : null;

  return (
    <DragProvider value={dragValue}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {confirmDialog}
        {toaster}
        <aside
          className="flex w-full shrink-0 flex-col gap-2 lg:w-72"
          onDrop={(e) => {
            if (!dragSource) return;
            e.preventDefault();
            void commitDrop().finally(dragEnd);
          }}
          onDragEnd={dragEnd}
        >
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <PanelHeader
              title="Smart variables"
              icon={
                <Atom
                  size={12}
                  aria-hidden
                  className="text-muted-foreground/70"
                />
              }
              menu={
                <RailPlusMenu
                  disabled={pending}
                  onNewSmartVariable={handleCreateSmartVariable}
                  onNewFolder={handleCreateFolder}
                  selectedFolder={singleSelectedFolder}
                  onDeleteFolder={(id) => void handleDeleteFolder(id)}
                />
              }
            />
            <FolderTreeView
              folders={smartFolders}
              childFoldersByParent={childFoldersByParent}
              sortedVariablesByFolder={sortedVariablesByFolder}
              isCollapsed={isCollapsedKey}
              onToggleCollapsed={toggleCollapsed}
              selectedIds={selectedIds}
              onSelect={(id, opts) => {
                handleSelect(id, opts);
                const docId = docByVariableId.get(id);
                if (docId && !opts?.extend) navigateToDoc(docId);
              }}
              pinnedId={pinnedId}
              onRenameVariable={handleRenameVariable}
              onRenameFolder={handleRenameFolder}
              onDropCommit={() => commitDrop().finally(dragEnd)}
              density="compact"
              emptyMessage="No Smart Variables yet. Click + New to create one."
            />
          </div>
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
              folders={regularFolders}
              nations={nations}
              leaves={{ result: smartResultLeaf }}
              panelTitle={activeDoc.name ?? "(unnamed)"}
              nameLeadingExtras={
                <SmartVariableColorButton
                  variable={
                    smartVariables.find(
                      (v) => v.smart_variable_doc_id === activeDoc.id
                    ) ?? null
                  }
                  onChange={(hex) =>
                    setSmartVariableColor({
                      documentId: activeDoc.id,
                      color_hex: hex,
                    })
                  }
                />
              }
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
                runTransition(async () => {
                  const fd = new FormData();
                  fd.set("id", activeDoc.id);
                  await deleteSmartVariable(fd);
                  navigateToDoc(null);
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
    </DragProvider>
  );
}

/** Color swatch rendered to the left of the Smart Variable name input.
 *  Matches the format used by `VariableInspector` (h-7 hit area, 5x5
 *  rounded-sm visible swatch). Falls back to `paletteColor(color_index)`
 *  when no override is set; optimistic state flashes the new color
 *  while the server commit resolves. */
function SmartVariableColorButton({
  variable,
  onChange,
}: {
  variable: EndingVariable | null;
  onChange: (hex: string) => Promise<void>;
}) {
  const [pendingHex, setPendingHex] = useState<string | null>(null);
  if (!variable) return null;
  const effective =
    pendingHex ??
    variable.color_hex ??
    paletteColor(variable.color_index);
  return (
    <label
      aria-label="Smart Variable chip color"
      title="Chip color"
      className="relative inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center"
    >
      <span
        aria-hidden
        className="block h-5 w-5 rounded-sm border border-border/60"
        style={{ backgroundColor: effective }}
      />
      <input
        type="color"
        value={effective}
        onChange={(e) => {
          const next = e.target.value;
          setPendingHex(next);
          void onChange(next).finally(() => setPendingHex(null));
        }}
        className="absolute inset-0 h-full w-7 cursor-pointer opacity-0"
      />
    </label>
  );
}

/** Right-aligned "+" menu in the rail's PanelHeader. Pops a small menu
 *  with the two create options; when a folder is single-selected the
 *  menu also exposes a destructive "Delete <folder>" item so folder
 *  deletion stays reachable without a separate header button. */
function RailPlusMenu({
  disabled,
  onNewSmartVariable,
  onNewFolder,
  selectedFolder,
  onDeleteFolder,
}: {
  disabled: boolean;
  onNewSmartVariable: () => void;
  onNewFolder: () => void;
  selectedFolder: EndingVariableFolder | null;
  onDeleteFolder: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      const t = e.target as Node;
      if (wrapRef.current.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const btn = buttonRef.current.getBoundingClientRect();
    setMenuPos({ top: btn.bottom + 4, left: btn.right - 200 });
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add"
        title="Add"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        <Plus size={14} aria-hidden />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 w-[200px] overflow-hidden rounded-md border border-border bg-popover shadow-md"
          style={{
            top: menuPos?.top ?? -9999,
            left: menuPos?.left ?? -9999,
            visibility: menuPos ? "visible" : "hidden",
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onNewSmartVariable();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] tracking-tight text-foreground transition-colors hover:bg-accent/40"
          >
            <Atom size={12} aria-hidden />
            New Smart Variable
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onNewFolder();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] tracking-tight text-foreground transition-colors hover:bg-accent/40"
          >
            <Plus size={12} aria-hidden />
            New folder
          </button>
          {selectedFolder ? (
            <>
              <div role="separator" className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onDeleteFolder(selectedFolder.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] tracking-tight text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
              >
                Delete &ldquo;{selectedFolder.name}&rdquo;
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
