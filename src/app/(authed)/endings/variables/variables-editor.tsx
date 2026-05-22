"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  Hash,
  Plus,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PanelHeader } from "@/components/panel";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";
import { colorIndexFor, paletteColor } from "@/lib/endings/color-palette";
import {
  isValidFolderDropTarget,
  type FolderLike,
} from "@/lib/endings/folder-drag";
import { useLocalStorage } from "@/lib/use-local-storage";
import type {
  EndingFramework,
  EndingLogicRuleCondition,
  EndingVariable,
  EndingVariableFolder,
  EndingVariableValue,
} from "@/lib/db/types";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import type { PresenceProfile } from "@/lib/realtime/presence";
import type { PostgresChange } from "@/lib/realtime/channel";
import {
  createEndingVariable,
  createEndingVariableFolder,
  createEndingVariableValue,
  deleteEndingVariable,
  deleteEndingVariableFolder,
  moveFolderToFolder,
  moveVariableToFolder,
  patchEndingVariable,
  patchEndingVariableFolder,
} from "./actions";
import { slugify } from "@/lib/slug";
import {
  VariableInspector,
  type FolderTreeOption,
} from "./variable-inspector";
import { FolderInspector } from "./folder-inspector";
import { buildFolderOptions } from "./folder-tree";
import { MultiSelectInspector } from "./multi-select-inspector";

type ViewMode = "all" | "by-ending";
type SortMode = "name" | "created_newest" | "created_oldest";
type CollapseMode = "expanded" | "collapsed";

const VIEW_KEY = "endings-variables-view";
const SORT_KEY = "endings-variables-sort";
const COLLAPSE_KEY = "endings-variables-collapse";

const VAR_TABLE = "ending_variables";
const VALUE_TABLE = "ending_variable_values";
const FOLDER_TABLE = "ending_variable_folders";

/** Single, fixed row height across the panel so renaming an item doesn't
 *  jiggle the layout. 28px ≈ comfortable click target without feeling
 *  spread out. Use the same height for variable rows, folder rows, By
 *  Ending panel headers, and the inline rename input. */
const ROW_HEIGHT_PX = 28;
const ROW_HEIGHT_CLS = "h-7"; // matches ROW_HEIGHT_PX

export type SelectOptions = { extend?: boolean };

type DragKind = "variable" | "folder";
type DragSource = { kind: DragKind; id: string };
/** Where the dragged row would land if released now. `intoFolder=true`
 *  means "drop into the folder body" (parent_folder_id set to that folder,
 *  inserted at the end of its children); otherwise we're inserting before
 *  the `before_id` sibling (or at the end of the group when null). */
type DragTarget = {
  parent_folder_id: string | null;
  before_id: string | null;
  intoFolder: boolean;
};
type DragContextValue = {
  source: DragSource | null;
  target: DragTarget | null;
  start: (source: DragSource) => void;
  /** Sets the pending target, validating it against the current source
   *  first (cycle guard for folder→folder). Returns `true` when the
   *  target was accepted — handlers should only call preventDefault on
   *  the dragover/drop event when this returns true. */
  proposeTarget: (target: DragTarget) => boolean;
  /** Clears the pending target without ending the drag (e.g. dragleave). */
  clearTarget: () => void;
  end: () => void;
};
const DragCtx = createContext<DragContextValue | null>(null);
function useDragCtx(): DragContextValue {
  const ctx = useContext(DragCtx);
  if (!ctx) throw new Error("DragCtx missing");
  return ctx;
}

export function VariablesEditor({
  variables,
  values,
  folders,
  frameworks,
  frameworkVariableRefs,
  logicConditions,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  variables: EndingVariable[];
  values: EndingVariableValue[];
  folders: EndingVariableFolder[];
  frameworks: EndingFramework[];
  frameworkVariableRefs: Array<{ framework_id: string; variable_id: string }>;
  logicConditions: Array<Pick<EndingLogicRuleCondition, "variable_id">>;
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="endings-variables"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={[VAR_TABLE, VALUE_TABLE, FOLDER_TABLE]}
    >
      <VariablesEditorInner
        variables={variables}
        values={values}
        folders={folders}
        frameworks={frameworks}
        frameworkVariableRefs={frameworkVariableRefs}
        logicConditions={logicConditions}
      />
    </WorkspacePresenceProvider>
  );
}

function VariablesEditorInner({
  variables: initialVariables,
  values: initialValues,
  folders: initialFolders,
  frameworks,
  frameworkVariableRefs,
  logicConditions,
}: {
  variables: EndingVariable[];
  values: EndingVariableValue[];
  folders: EndingVariableFolder[];
  frameworks: EndingFramework[];
  frameworkVariableRefs: Array<{ framework_id: string; variable_id: string }>;
  logicConditions: Array<Pick<EndingLogicRuleCondition, "variable_id">>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { peers, onPostgresChanges, pingActivity } = usePresenceContext();
  const { toast, toaster } = useToast();

  // Local mirrors. Reconciled from server props (revalidate path) and
  // patched in-place by realtime postgres_changes below.
  const [variables, setVariables] = useState<EndingVariable[]>(initialVariables);
  const [values, setValues] = useState<EndingVariableValue[]>(initialValues);
  const [folders, setFolders] = useState<EndingVariableFolder[]>(initialFolders);

  // Server-prop reconciliation: preserve local rows already present, append
  // new ones, drop removed ones. Render-time setState (vs. useEffect) so
  // the new react-hooks/set-state-in-effect rule stays happy — the
  // identity check on the server-prop reference is the only trigger we
  // need.
  const [prevInitialVariables, setPrevInitialVariables] = useState(
    initialVariables
  );
  if (initialVariables !== prevInitialVariables) {
    setPrevInitialVariables(initialVariables);
    setVariables((prev) => reconcileById(prev, initialVariables));
  }
  const [prevInitialValues, setPrevInitialValues] = useState(initialValues);
  if (initialValues !== prevInitialValues) {
    setPrevInitialValues(initialValues);
    setValues((prev) => reconcileById(prev, initialValues));
  }
  const [prevInitialFolders, setPrevInitialFolders] = useState(initialFolders);
  if (initialFolders !== prevInitialFolders) {
    setPrevInitialFolders(initialFolders);
    setFolders((prev) => reconcileById(prev, initialFolders));
  }

  // Realtime fan-out — variable / value / folder INSERT triggers a refresh
  // so server-derived joins (framework refs etc.) recompute; UPDATE + DELETE
  // patch locally to avoid the round-trip.
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      if (change.table === VAR_TABLE) {
        if (change.eventType === "UPDATE" && change.new) {
          const updated = change.new as unknown as EndingVariable;
          if (updated.kind !== "text") return;
          setVariables((prev) =>
            prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const deleted = change.old as unknown as { id: string };
          setVariables((prev) => prev.filter((r) => r.id !== deleted.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const inserted = change.new as unknown as EndingVariable;
          if (inserted.kind !== "text") return;
          startTransition(() => router.refresh());
        }
        return;
      }
      if (change.table === VALUE_TABLE) {
        if (change.eventType === "UPDATE" && change.new) {
          const v = change.new as unknown as EndingVariableValue;
          setValues((prev) => prev.map((r) => (r.id === v.id ? { ...r, ...v } : r)));
        } else if (change.eventType === "DELETE" && change.old) {
          const old = change.old as unknown as { id: string };
          setValues((prev) => prev.filter((r) => r.id !== old.id));
        } else if (change.eventType === "INSERT" && change.new) {
          const v = change.new as unknown as EndingVariableValue;
          setValues((prev) => (prev.some((r) => r.id === v.id) ? prev : [...prev, v]));
        }
        return;
      }
      if (change.table === FOLDER_TABLE) {
        if (change.eventType === "UPDATE" && change.new) {
          const f = change.new as unknown as EndingVariableFolder;
          setFolders((prev) =>
            prev.map((r) => (r.id === f.id ? { ...r, ...f } : r))
          );
        } else if (change.eventType === "DELETE" && change.old) {
          const old = change.old as unknown as { id: string };
          setFolders((prev) => prev.filter((r) => r.id !== old.id));
        } else if (change.eventType === "INSERT" && change.new) {
          startTransition(() => router.refresh());
        }
      }
    });
  }, [onPostgresChanges, router]);

  const [view, setView] = useLocalStorage<ViewMode>(VIEW_KEY, "all");
  const [sort, setSort] = useLocalStorage<SortMode>(SORT_KEY, "name");
  const [collapseMode, setCollapseMode] = useLocalStorage<CollapseMode>(
    COLLAPSE_KEY,
    "expanded"
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  function applyCollapseMode(mode: CollapseMode) {
    setCollapseMode(mode);
    setCollapsedIds(new Set());
  }
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

  // URL deep-link: ?name=<slug> hydrates selection. Variables are checked
  // first; if no match, folders are checked. Only synced back to the URL
  // when exactly one item is selected.
  const initialSelectedIds = useMemo(() => {
    const slug = searchParams.get("name");
    if (!slug) return new Set<string>();
    const matchedVar = initialVariables.find(
      (v) => v.kind === "text" && slugify(v.name) === slug
    );
    if (matchedVar) return new Set([matchedVar.id]);
    const matchedFolder = initialFolders.find(
      (f) => slugify(f.name) === slug
    );
    if (matchedFolder) return new Set([matchedFolder.id]);
    return new Set<string>();
  }, [searchParams, initialVariables, initialFolders]);
  const [selectedIds, setSelectedIds] =
    useState<Set<string>>(initialSelectedIds);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  const syncUrl = useCallback(
    (ids: Set<string>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("name");
      if (ids.size === 1) {
        const [only] = Array.from(ids);
        const matchedVar = variables.find((v) => v.id === only);
        if (matchedVar) {
          params.set("name", slugify(matchedVar.name));
        } else {
          const matchedFolder = folders.find((f) => f.id === only);
          if (matchedFolder) params.set("name", slugify(matchedFolder.name));
        }
      }
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [searchParams, router, variables, folders]
  );

  const handleSelect = useCallback(
    (id: string, opts?: SelectOptions) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (opts?.extend) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          next.clear();
          next.add(id);
        }
        syncUrl(next);
        return next;
      });
    },
    [syncUrl]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    syncUrl(new Set());
  }, [syncUrl]);

  // Derived: text-only variables (number_ref/aggregate slots stay out of
  // the editor view).
  const textVariables = useMemo(
    () => variables.filter((v) => v.kind === "text"),
    [variables]
  );

  const valuesByVariable = useMemo(() => {
    const m = new Map<string, EndingVariableValue[]>();
    for (const v of values) {
      const list = m.get(v.variable_id) ?? [];
      list.push(v);
      m.set(v.variable_id, list);
    }
    return m;
  }, [values]);

  const childFoldersByParent = useMemo(() => {
    const m = new Map<string | null, EndingVariableFolder[]>();
    for (const f of folders) {
      const key = f.parent_folder_id ?? null;
      const list = m.get(key) ?? [];
      list.push(f);
      m.set(key, list);
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      );
    }
    return m;
  }, [folders]);

  const variablesByFolder = useMemo(() => {
    const m = new Map<string | null, EndingVariable[]>();
    for (const v of textVariables) {
      const key = v.folder_id ?? null;
      const list = m.get(key) ?? [];
      list.push(v);
      m.set(key, list);
    }
    return m;
  }, [textVariables]);

  const sortedVariablesByFolder = useMemo(() => {
    const m = new Map<string | null, EndingVariable[]>();
    for (const [k, list] of variablesByFolder) {
      m.set(k, sortVariables(list, sort));
    }
    return m;
  }, [variablesByFolder, sort]);

  // Indented folder-picker option list. `excludedIds` (and every
  // descendant of each) is omitted so we can't reparent a folder under
  // itself. Implementation lives in folder-tree.ts so the
  // create-variable popover can reuse it.
  const allFolderOptions = useMemo<FolderTreeOption[]>(
    () => buildFolderOptions(folders),
    [folders]
  );

  const variableRefs = useMemo(() => {
    const byFramework = new Map<string, Set<string>>();
    for (const ref of frameworkVariableRefs) {
      const set = byFramework.get(ref.framework_id) ?? new Set<string>();
      set.add(ref.variable_id);
      byFramework.set(ref.framework_id, set);
    }
    const logicIds = new Set(
      logicConditions.map((c) => c.variable_id).filter(Boolean)
    );
    return { byFramework, logicIds };
  }, [frameworkVariableRefs, logicConditions]);

  const allReferencedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of variableRefs.byFramework.values())
      for (const id of s) ids.add(id);
    for (const id of variableRefs.logicIds) ids.add(id);
    return ids;
  }, [variableRefs]);

  const byEndingPanels = useMemo(() => {
    const panels: Array<{
      key: string;
      title: string;
      rows: EndingVariable[];
    }> = [];
    for (const fw of frameworks) {
      const ids = variableRefs.byFramework.get(fw.id) ?? new Set<string>();
      const rows = textVariables.filter((r) => ids.has(r.id));
      if (rows.length === 0) continue;
      panels.push({
        key: `framework:${fw.id}`,
        title: fw.name,
        rows: sortVariables(rows, sort),
      });
    }
    const logicRows = textVariables.filter((r) =>
      variableRefs.logicIds.has(r.id)
    );
    if (logicRows.length > 0) {
      panels.push({
        key: "logic",
        title: "Ending logic",
        rows: sortVariables(logicRows, sort),
      });
    }
    const unrefRows = textVariables.filter((r) => !allReferencedIds.has(r.id));
    panels.push({
      key: "unreferenced",
      title: "Unreferenced",
      rows: sortVariables(unrefRows, sort),
    });
    return panels;
  }, [frameworks, variableRefs, textVariables, allReferencedIds, sort]);

  // Optimistic create — client mints the id and inserts into the local
  // mirror immediately, then fires the server action; on error, rolls back.
  function handleCreateVariable() {
    const id = makeUuid();
    // Pick parent folder from the single-selected item (folder → itself,
    // variable → its folder); fall back to root.
    let folderId: string | null = null;
    if (selectedIds.size === 1) {
      const [only] = Array.from(selectedIds);
      if (folders.some((f) => f.id === only)) folderId = only;
      else folderId = variables.find((v) => v.id === only)?.folder_id ?? null;
    }
    const nextSort =
      textVariables.reduce((m, v) => Math.max(m, v.sort_order), 0) + 1;
    const optimistic: EndingVariable = {
      id,
      name: "New variable",
      default_value_id: null,
      sort_order: nextSort,
      kind: "text",
      number_ref: null,
      aggregate_ref: null,
      smart_variable_doc_id: null,
      color_index: colorIndexFor(id),
      color_hex: null,
      folder_id: folderId,
      created_at: new Date().toISOString(),
    };
    setVariables((prev) => [...prev, optimistic]);
    handleSelect(id);
    void (async () => {
      try {
        await createEndingVariable({ id, folder_id: folderId });
      } catch (err) {
        // Roll back the optimistic insert.
        setVariables((prev) => prev.filter((v) => v.id !== id));
        const msg = err instanceof Error ? err.message : "Create failed.";
        toast({ message: msg, intent: "destructive" });
      }
    })();
  }

  function handleCreateFolder() {
    const id = makeUuid();
    let parentId: string | null = null;
    if (selectedIds.size === 1) {
      const [only] = Array.from(selectedIds);
      if (folders.some((f) => f.id === only)) parentId = only;
      else parentId = variables.find((v) => v.id === only)?.folder_id ?? null;
    }
    const siblings = folders.filter(
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
      created_at: now,
      updated_at: now,
    };
    setFolders((prev) => [...prev, optimistic]);
    setPinnedId(id);
    handleSelect(id);
    void (async () => {
      try {
        await createEndingVariableFolder({ id, parent_folder_id: parentId });
      } catch (err) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        setPinnedId((cur) => (cur === id ? null : cur));
        const msg = err instanceof Error ? err.message : "Create failed.";
        toast({ message: msg, intent: "destructive" });
      }
    })();
  }

  // Add-value flow used by the inspector. Optimistically inserts the value
  // into the editor's local mirror so it appears immediately; reconciles
  // the name to whatever the server picked (uniqueness rules might bump
  // "New value" → "New value 2").
  const handleAddValue = useCallback(
    async (variableId: string): Promise<string | null> => {
      const id = makeUuid();
      const existing = values.filter((v) => v.variable_id === variableId);
      const nextSort =
        existing.reduce((m, v) => Math.max(m, v.sort_order), 0) + 1;
      const optimistic: EndingVariableValue = {
        id,
        variable_id: variableId,
        value: "New value",
        sort_order: nextSort,
      };
      setValues((prev) => [...prev, optimistic]);
      try {
        const fd = new FormData();
        fd.set("variable_id", variableId);
        fd.set("id", id);
        const { value: actualValue } = await createEndingVariableValue(fd);
        if (actualValue !== optimistic.value) {
          setValues((prev) =>
            prev.map((v) => (v.id === id ? { ...v, value: actualValue } : v))
          );
        }
        return id;
      } catch (err) {
        setValues((prev) => prev.filter((v) => v.id !== id));
        const msg = err instanceof Error ? err.message : "Create failed.";
        toast({ message: msg, intent: "destructive" });
        return null;
      }
    },
    [values, toast]
  );

  function handleDeleted() {
    clearSelection();
    setPinnedId(null);
  }

  // Resolve the single-selection inspector target.
  const isSingle = selectedIds.size === 1;
  const isMulti = selectedIds.size > 1;
  const singleId = isSingle ? Array.from(selectedIds)[0] : null;
  const selectedVariable =
    singleId !== null
      ? textVariables.find((v) => v.id === singleId) ?? null
      : null;
  const selectedFolder =
    singleId !== null
      ? folders.find((f) => f.id === singleId) ?? null
      : null;

  // Rename → URL sync: when the single-selected item is renamed, update the
  // URL slug so a reload resolves to the same item under its new name.
  // Guard with searchParams.get('name') !== newSlug to avoid URL-update loops.
  useEffect(() => {
    if (!isSingle || singleId === null) return;
    const selectedItem = selectedVariable ?? selectedFolder;
    if (!selectedItem) return;
    const newSlug = slugify(selectedItem.name);
    if (searchParams.get("name") !== newSlug) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("name", newSlug);
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    }
  // Only re-run when the selected item's name changes, not on every searchParams update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariable?.name, selectedFolder?.name]);

  // Drop a single-selection id that vanished from the data. Render-time
  // setState (vs. useEffect) so the new react-hooks/set-state-in-effect
  // rule stays happy.
  if (
    isSingle &&
    singleId !== null &&
    !selectedVariable &&
    !selectedFolder
  ) {
    clearSelection();
  }

  // Counts used by the folder inspector summary.
  const childCountsByFolder = useMemo(() => {
    const m = new Map<string, { folders: number; variables: number }>();
    for (const f of folders) m.set(f.id, { folders: 0, variables: 0 });
    for (const f of folders) {
      if (f.parent_folder_id && m.has(f.parent_folder_id)) {
        m.get(f.parent_folder_id)!.folders += 1;
      }
    }
    for (const v of textVariables) {
      if (v.folder_id && m.has(v.folder_id)) {
        m.get(v.folder_id)!.variables += 1;
      }
    }
    return m;
  }, [folders, textVariables]);

  const handleOnPatchError = useCallback(
    (msg: string) => toast({ message: msg, intent: "destructive" }),
    [toast]
  );

  // ── Drag-and-drop ─────────────────────────────────────────────────
  // Two-phase commit: dragover stashes the proposed target; drop fires
  // the optimistic local mutation + the server move. The server
  // revalidates and the prop-reconcile snaps state back if anything
  // went wrong.
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

  // Folders, as the pure-helper FolderLike list (subset of fields the
  // cycle guard needs). Declared up here so the drag context's closure
  // captures it; memoised so downstream callbacks don't churn.
  const foldersForCycle = useMemo<FolderLike[]>(
    () =>
      folders.map((f) => ({
        id: f.id,
        parent_folder_id: f.parent_folder_id,
      })),
    [folders]
  );

  // Commit the pending drop. Returns true if anything moved.
  const commitDrop = useCallback(async (): Promise<boolean> => {
    const source = dragSource;
    const target = dragTarget;
    if (!source || !target) return false;
    // No-op: dropped onto self.
    if (source.id === target.before_id) return false;

    if (source.kind === "variable") {
      const variable = variables.find((v) => v.id === source.id);
      if (!variable) return false;
      // Skip a same-position move (same folder, same neighbor).
      const samePosition =
        (variable.folder_id ?? null) === target.parent_folder_id &&
        (() => {
          const siblings = [...textVariables]
            .filter(
              (v) => (v.folder_id ?? null) === target.parent_folder_id
            )
            .sort((a, b) => a.sort_order - b.sort_order);
          const idx = siblings.findIndex((s) => s.id === source.id);
          const afterId = siblings[idx + 1]?.id ?? null;
          return (target.before_id ?? null) === afterId;
        })();
      if (samePosition) return false;
      // Optimistic local mutation.
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
        await moveVariableToFolder({
          variable_id: source.id,
          folder_id: target.parent_folder_id,
          before_id: target.before_id,
        });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Move failed.";
        toast({ message: msg, intent: "destructive" });
        startTransition(() => router.refresh());
        return false;
      }
    }

    // source.kind === "folder"
    // Client-side cycle guard (DB trigger is the final wall).
    if (
      !isValidFolderDropTarget(folders, source.id, target.parent_folder_id)
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
      await moveFolderToFolder({
        folder_id: source.id,
        parent_folder_id: target.parent_folder_id,
        before_id: target.before_id,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Move failed.";
      toast({ message: msg, intent: "destructive" });
      startTransition(() => router.refresh());
      return false;
    }
  }, [dragSource, dragTarget, variables, textVariables, folders, router, toast]);

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

  function handleRenameVariable(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Optimistic local update so the row reflects the rename instantly,
    // even before the server echo lands.
    setVariables((prev) =>
      prev.map((v) => (v.id === id ? { ...v, name: trimmed } : v))
    );
    void (async () => {
      try {
        await patchEndingVariable(id, { name: trimmed });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Rename failed.";
        toast({ message: msg, intent: "destructive" });
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
        await patchEndingVariableFolder(id, { name: trimmed });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Rename failed.";
        toast({ message: msg, intent: "destructive" });
      }
    })();
  }

  // Multi-select bulk move. Cycle protection: if any selected folder is an
  // ancestor of the destination, refuse the move (the DB trigger is the
  // backstop but the toast here is friendlier).
  function isAncestorOrSelf(
    candidateAncestorId: string,
    nodeId: string
  ): boolean {
    let current: string | null | undefined = nodeId;
    while (current) {
      if (current === candidateAncestorId) return true;
      const parent = folders.find((f) => f.id === current);
      current = parent?.parent_folder_id ?? null;
    }
    return false;
  }

  async function handleBulkMove(folderId: string | null) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Validate cycle safety against any selected folder.
    if (folderId) {
      for (const id of ids) {
        if (folders.some((f) => f.id === id)) {
          if (isAncestorOrSelf(id, folderId)) {
            toast({
              message: `Can't move "${folders.find((f) => f.id === id)?.name ?? "folder"}" into itself or a descendant.`,
              intent: "destructive",
            });
            return;
          }
        }
      }
    }
    // Optimistic mirror update.
    setVariables((prev) =>
      prev.map((v) =>
        selectedIds.has(v.id) ? { ...v, folder_id: folderId } : v
      )
    );
    setFolders((prev) =>
      prev.map((f) =>
        selectedIds.has(f.id) ? { ...f, parent_folder_id: folderId } : f
      )
    );
    const errs: string[] = [];
    await Promise.all(
      ids.map(async (id) => {
        try {
          if (variables.some((v) => v.id === id)) {
            await patchEndingVariable(id, { folder_id: folderId });
          } else if (folders.some((f) => f.id === id)) {
            await patchEndingVariableFolder(id, { parent_folder_id: folderId });
          }
        } catch (err) {
          errs.push(err instanceof Error ? err.message : "Move failed.");
        }
      })
    );
    if (errs.length > 0) {
      toast({
        message: `${errs.length} move${errs.length === 1 ? "" : "s"} failed: ${errs[0]}`,
        intent: "destructive",
      });
      // Trigger a refresh to reconcile against the server.
      startTransition(() => router.refresh());
    }
    // Drop the selection so the inspector returns to the empty state and
    // the rows visually settle into their new homes.
    clearSelection();
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const folderIds = ids.filter((id) => folders.some((f) => f.id === id));
    const variableIds = ids.filter((id) =>
      variables.some((v) => v.id === id)
    );
    // Variables first (no FK from folders to variables), then folders.
    for (const id of variableIds) {
      const fd = new FormData();
      fd.set("id", id);
      try {
        await deleteEndingVariable(fd);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed.";
        toast({ message: msg, intent: "destructive" });
      }
    }
    for (const id of folderIds) {
      const fd = new FormData();
      fd.set("id", id);
      try {
        await deleteEndingVariableFolder(fd);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed.";
        toast({ message: msg, intent: "destructive" });
      }
    }
    clearSelection();
  }

  // Multi-select inspector inputs (counts, folder picker excludes any
  // selected folder so we don't move INTO ourselves).
  const multiVariableCount = useMemo(
    () => Array.from(selectedIds).filter((id) =>
      variables.some((v) => v.id === id)
    ).length,
    [selectedIds, variables]
  );
  const multiFolderCount = useMemo(
    () => Array.from(selectedIds).filter((id) =>
      folders.some((f) => f.id === id)
    ).length,
    [selectedIds, folders]
  );
  const multiFolderOptions = useMemo(
    () =>
      buildFolderOptions(
        folders,
        Array.from(selectedIds).filter((id) =>
          folders.some((f) => f.id === id)
        )
      ),
    [selectedIds, folders]
  );

  // Single-selection inspector — exclude the selected folder + descendants
  // from its parent picker so it can't be set as its own ancestor.
  const singleFolderOptions = useMemo(
    () =>
      selectedFolder
        ? buildFolderOptions(folders, [selectedFolder.id])
        : buildFolderOptions(folders),
    [selectedFolder, folders]
  );

  return (
    <DragCtx.Provider value={dragValue}>
      {toaster}
      <ControlBar
        view={view}
        onView={setView}
        sort={sort}
        onSort={setSort}
        collapseMode={collapseMode}
        onCollapseMode={applyCollapseMode}
        onCreateVariable={handleCreateVariable}
        onCreateFolder={handleCreateFolder}
      />

      <div className="flex items-start gap-4">
        <div
          className="sticky top-4 min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card"
          // Catch a drop that lands on the panel chrome (anywhere outside
          // a specific row). Without this, releasing inside the panel
          // but not over a row would do nothing instead of committing
          // the user's last-known intent.
          onDrop={(e) => {
            if (!dragSource) return;
            e.preventDefault();
            void commitDrop().finally(dragEnd);
          }}
          onDragEnd={dragEnd}
        >
          <PanelHeader
            title="Variables"
            icon={
              <Hash
                size={14}
                aria-hidden
                className="text-muted-foreground/70"
              />
            }
          />
          {view === "all" ? (
            <AllListView
              folders={folders}
              childFoldersByParent={childFoldersByParent}
              sortedVariablesByFolder={sortedVariablesByFolder}
              isCollapsed={isCollapsedKey}
              onToggleCollapsed={toggleCollapsed}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              pinnedId={pinnedId}
              onRenameVariable={handleRenameVariable}
              onRenameFolder={handleRenameFolder}
              onDropCommit={() => commitDrop().finally(dragEnd)}
            />
          ) : (
            <ByEndingView
              panels={byEndingPanels}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              isCollapsed={isCollapsedKey}
              onToggleCollapsed={toggleCollapsed}
              onRenameVariable={handleRenameVariable}
            />
          )}
        </div>

        {isMulti ? (
          <div className="sticky top-4 w-[400px] shrink-0">
            <MultiSelectInspector
              variableCount={multiVariableCount}
              folderCount={multiFolderCount}
              folderOptions={multiFolderOptions}
              onMove={handleBulkMove}
              onDelete={handleBulkDelete}
              onClear={clearSelection}
            />
          </div>
        ) : selectedVariable ? (
          <div className="sticky top-4 w-[400px] shrink-0">
            <VariableInspector
              key={selectedVariable.id}
              variable={selectedVariable}
              values={valuesByVariable.get(selectedVariable.id) ?? []}
              folderOptions={allFolderOptions}
              peers={peers}
              onActivity={pingActivity}
              onPatchError={handleOnPatchError}
              onDeleted={handleDeleted}
              onAddValue={handleAddValue}
            />
          </div>
        ) : selectedFolder ? (
          <div className="sticky top-4 w-[400px] shrink-0">
            <FolderInspector
              key={selectedFolder.id}
              folder={selectedFolder}
              folderOptions={singleFolderOptions}
              childFolderCount={
                childCountsByFolder.get(selectedFolder.id)?.folders ?? 0
              }
              childVariableCount={
                childCountsByFolder.get(selectedFolder.id)?.variables ?? 0
              }
              peers={peers}
              onActivity={pingActivity}
              onPatchError={handleOnPatchError}
              onDeleted={handleDeleted}
            />
          </div>
        ) : null}
      </div>
    </DragCtx.Provider>
  );
}

function reconcileById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const nextIds = new Set(next.map((r) => r.id));
  const kept = prev.filter((r) => nextIds.has(r.id));
  const keptIds = new Set(kept.map((r) => r.id));
  const additions = next.filter((s) => !prevById.has(s.id) && !keptIds.has(s.id));
  if (additions.length === 0 && kept.length === prev.length) return prev;
  return [...kept, ...additions];
}

function sortVariables(rows: EndingVariable[], mode: SortMode): EndingVariable[] {
  const copy = [...rows];
  if (mode === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (mode === "created_oldest") {
    copy.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } else {
    copy.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return copy;
}

/** Client-side UUID for optimistic inserts. crypto.randomUUID is available
 *  in modern browsers + node 19+; fall back to a non-cryptographic id if a
 *  legacy runtime is in play (extremely unlikely here). */
function makeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Last-resort RFC 4122 v4-ish id without crypto.
  return "00000000-0000-4000-8000-000000000000".replace(/[0]/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

function ControlBar({
  view,
  onView,
  sort,
  onSort,
  collapseMode,
  onCollapseMode,
  onCreateVariable,
  onCreateFolder,
}: {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  collapseMode: CollapseMode;
  onCollapseMode: (c: CollapseMode) => void;
  onCreateVariable: () => void;
  onCreateFolder: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <PlusMenu onVariable={onCreateVariable} onFolder={onCreateFolder} />
      <ViewToggle view={view} onChange={onView} />
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <CollapseModeToggle mode={collapseMode} onChange={onCollapseMode} />
        <Label className="ml-1 !text-xs">Sort</Label>
        <Select
          value={sort}
          onChange={(e) => onSort(e.target.value as SortMode)}
          className="h-8 w-auto"
        >
          <option value="name">Name</option>
          <option value="created_newest">Created (newest)</option>
          <option value="created_oldest">Created (oldest)</option>
        </Select>
      </div>
    </div>
  );
}

function PlusMenu({
  onVariable,
  onFolder,
}: {
  onVariable: () => void;
  onFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null
  );

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      const target = e.target as Node;
      if (ref.current.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const btn = buttonRef.current.getBoundingClientRect();
    setMenuPos({ top: btn.bottom + 4, left: btn.left });
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add"
        title="Add"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus size={16} aria-hidden />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 w-max min-w-[160px] overflow-hidden rounded-md border border-border bg-popover shadow-md"
          style={{
            top: menuPos?.top ?? -9999,
            left: menuPos?.left ?? -9999,
            visibility: menuPos ? "visible" : "hidden",
          }}
        >
          <MenuItem
            icon={<Hash size={12} aria-hidden />}
            label="New variable"
            onClick={() => {
              onVariable();
              setOpen(false);
            }}
          />
          <MenuItem
            icon={<Folder size={12} aria-hidden />}
            label="New folder"
            onClick={() => {
              onFolder();
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left font-mono text-[11px] tracking-tight text-foreground transition-colors hover:bg-accent/40"
    >
      {icon}
      {label}
    </button>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const items: { id: ViewMode; label: string }[] = [
    { id: "all", label: "All" },
    { id: "by-ending", label: "By Ending" },
  ];
  return (
    <div
      role="tablist"
      aria-label="View"
      className="inline-flex h-8 overflow-hidden rounded-md border border-border bg-card text-xs"
    >
      {items.map((item) => {
        const active = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "px-3 transition-colors",
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/40"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function CollapseModeToggle({
  mode,
  onChange,
}: {
  mode: CollapseMode;
  onChange: (c: CollapseMode) => void;
}) {
  const items: { id: CollapseMode; label: string; icon: React.ReactNode }[] = [
    {
      id: "expanded",
      label: "Expand all",
      icon: <ChevronsUpDown size={14} aria-hidden />,
    },
    {
      id: "collapsed",
      label: "Collapse all",
      icon: <ChevronsDownUp size={14} aria-hidden />,
    },
  ];
  return (
    <div
      role="group"
      aria-label="Collapse mode"
      className="flex h-8 items-center overflow-hidden rounded-md border border-border"
    >
      {items.map((item, i) => {
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-pressed={active}
            aria-label={item.label}
            title={item.label}
            className={cn(
              "inline-flex h-full w-8 items-center justify-center transition-colors",
              i > 0 && "border-l border-border",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
}

function AllListView({
  folders,
  childFoldersByParent,
  sortedVariablesByFolder,
  isCollapsed,
  onToggleCollapsed,
  selectedIds,
  onSelect,
  pinnedId,
  onRenameVariable,
  onRenameFolder,
  onDropCommit,
}: {
  folders: EndingVariableFolder[];
  childFoldersByParent: Map<string | null, EndingVariableFolder[]>;
  sortedVariablesByFolder: Map<string | null, EndingVariable[]>;
  isCollapsed: (id: string) => boolean;
  onToggleCollapsed: (id: string) => void;
  selectedIds: Set<string>;
  onSelect: (id: string, opts?: SelectOptions) => void;
  pinnedId: string | null;
  onRenameVariable: (id: string, name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDropCommit: () => void;
}) {
  const drag = useDragCtx();
  const rootFolders = childFoldersByParent.get(null) ?? [];
  const rootVariables = sortedVariablesByFolder.get(null) ?? [];

  if (folders.length === 0 && rootVariables.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        No variables or folders yet.
      </p>
    );
  }

  const pinnedFolder =
    pinnedId !== null
      ? rootFolders.find((f) => f.id === pinnedId) ?? null
      : null;

  return (
    <div>
      {pinnedFolder ? (
        <FolderBranch
          key={`pinned-${pinnedFolder.id}`}
          folder={pinnedFolder}
          depth={0}
          parentFolderId={null}
          childFoldersByParent={childFoldersByParent}
          sortedVariablesByFolder={sortedVariablesByFolder}
          isCollapsed={isCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onRenameVariable={onRenameVariable}
          onRenameFolder={onRenameFolder}
          onDropCommit={onDropCommit}
        />
      ) : null}
      {rootFolders
        .filter((f) => f.id !== pinnedId)
        .map((f) => (
          <FolderBranch
            key={f.id}
            folder={f}
            depth={0}
            parentFolderId={null}
            childFoldersByParent={childFoldersByParent}
            sortedVariablesByFolder={sortedVariablesByFolder}
            isCollapsed={isCollapsed}
            onToggleCollapsed={onToggleCollapsed}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onRenameVariable={onRenameVariable}
            onRenameFolder={onRenameFolder}
            onDropCommit={onDropCommit}
          />
        ))}
      {rootVariables.map((v) => (
        <VariableRow
          key={v.id}
          variable={v}
          depth={0}
          parentFolderId={null}
          selected={selectedIds.has(v.id)}
          onSelect={(opts) => onSelect(v.id, opts)}
          onRename={(name) => onRenameVariable(v.id, name)}
          onDropCommit={onDropCommit}
        />
      ))}
      {/* Root tail-drop zone: a release on the empty space below the
          last root item moves the dragged row to the end of root. */}
      <RootTailDropZone
        onPropose={() =>
          drag.proposeTarget({
            parent_folder_id: null,
            before_id: null,
            intoFolder: false,
          })
        }
        onDrop={onDropCommit}
        active={
          drag.source !== null &&
          drag.target?.parent_folder_id === null &&
          drag.target?.before_id === null
        }
      />
    </div>
  );
}

function RootTailDropZone({
  onPropose,
  onDrop,
  active,
}: {
  onPropose: () => boolean;
  onDrop: () => void;
  active: boolean;
}) {
  return (
    <div
      onDragOver={(e) => {
        if (onPropose()) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDragEnter={(e) => {
        if (onPropose()) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        "border-t border-border transition-colors",
        // Always visible (12px tall) so users can target the tail even
        // when the list has only a few rows; brightens when active.
        "h-3",
        active && "bg-accent/30"
      )}
    />
  );
}

function FolderBranch({
  folder,
  depth,
  parentFolderId,
  childFoldersByParent,
  sortedVariablesByFolder,
  isCollapsed,
  onToggleCollapsed,
  selectedIds,
  onSelect,
  onRenameVariable,
  onRenameFolder,
  onDropCommit,
}: {
  folder: EndingVariableFolder;
  depth: number;
  /** Folder this branch lives inside; null at root. Needed by the row
   *  drop handlers to compute insert-before-self and insert-after-self
   *  targets at the correct parent level. */
  parentFolderId: string | null;
  childFoldersByParent: Map<string | null, EndingVariableFolder[]>;
  sortedVariablesByFolder: Map<string | null, EndingVariable[]>;
  isCollapsed: (id: string) => boolean;
  onToggleCollapsed: (id: string) => void;
  selectedIds: Set<string>;
  onSelect: (id: string, opts?: SelectOptions) => void;
  onRenameVariable: (id: string, name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDropCommit: () => void;
}) {
  const drag = useDragCtx();
  const collapsed = isCollapsed(folder.id);
  const childFolders = childFoldersByParent.get(folder.id) ?? [];
  const childVariables = sortedVariablesByFolder.get(folder.id) ?? [];
  const totalChildren = childFolders.length + childVariables.length;
  // Empty-body drop zone: dragging onto an open, empty folder body lands
  // the item inside that folder.
  const emptyZoneActive =
    drag.source !== null &&
    drag.target?.intoFolder === true &&
    drag.target?.parent_folder_id === folder.id;
  return (
    <>
      <FolderRow
        folder={folder}
        depth={depth}
        parentFolderId={parentFolderId}
        collapsed={collapsed}
        childCount={totalChildren}
        selected={selectedIds.has(folder.id)}
        onSelect={(opts) => onSelect(folder.id, opts)}
        onToggle={() => onToggleCollapsed(folder.id)}
        onRename={(name) => onRenameFolder(folder.id, name)}
        onDropCommit={onDropCommit}
      />
      {collapsed
        ? null
        : (
          <>
            {childFolders.map((sub) => (
              <FolderBranch
                key={sub.id}
                folder={sub}
                depth={depth + 1}
                parentFolderId={folder.id}
                childFoldersByParent={childFoldersByParent}
                sortedVariablesByFolder={sortedVariablesByFolder}
                isCollapsed={isCollapsed}
                onToggleCollapsed={onToggleCollapsed}
                selectedIds={selectedIds}
                onSelect={onSelect}
                onRenameVariable={onRenameVariable}
                onRenameFolder={onRenameFolder}
                onDropCommit={onDropCommit}
              />
            ))}
            {childVariables.map((v) => (
              <VariableRow
                key={v.id}
                variable={v}
                depth={depth + 1}
                parentFolderId={folder.id}
                selected={selectedIds.has(v.id)}
                onSelect={(opts) => onSelect(v.id, opts)}
                onRename={(name) => onRenameVariable(v.id, name)}
                onDropCommit={onDropCommit}
              />
            ))}
            {totalChildren === 0 ? (
              <div
                onDragOver={(e) => {
                  if (
                    drag.proposeTarget({
                      parent_folder_id: folder.id,
                      before_id: null,
                      intoFolder: true,
                    })
                  ) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }
                }}
                onDragEnter={(e) => {
                  if (
                    drag.proposeTarget({
                      parent_folder_id: folder.id,
                      before_id: null,
                      intoFolder: true,
                    })
                  ) {
                    e.preventDefault();
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDropCommit();
                }}
                className={cn(
                  "flex items-center border-t border-border text-[11px] italic text-muted-foreground/60 transition-colors",
                  ROW_HEIGHT_CLS,
                  emptyZoneActive && "bg-accent/30"
                )}
                style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}
              >
                empty
              </div>
            ) : null}
          </>
        )}
    </>
  );
}

function FolderRow({
  folder,
  depth,
  parentFolderId,
  collapsed,
  childCount,
  selected,
  onSelect,
  onToggle,
  onRename,
  onDropCommit,
}: {
  folder: EndingVariableFolder;
  depth: number;
  parentFolderId: string | null;
  collapsed: boolean;
  childCount: number;
  selected: boolean;
  onSelect: (opts?: SelectOptions) => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDropCommit: () => void;
}) {
  return (
    <RowShell
      kind="folder"
      id={folder.id}
      parentFolderId={parentFolderId}
      selected={selected}
      onSelect={onSelect}
      paddingLeftPx={depth * 16 + 8}
      onDropCommit={onDropCommit}
    >
      <span
        role="button"
        aria-label={collapsed ? "Expand folder" : "Collapse folder"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent/60"
      >
        {collapsed ? (
          <ChevronRight size={14} aria-hidden />
        ) : (
          <ChevronDown size={14} aria-hidden />
        )}
      </span>
      {collapsed ? (
        <Folder size={13} aria-hidden className="shrink-0 text-muted-foreground" />
      ) : (
        <FolderOpen size={13} aria-hidden className="shrink-0 text-muted-foreground" />
      )}
      <RenamableLabel
        value={folder.name}
        placeholder="Unnamed folder"
        className="min-w-0 flex-1 truncate font-medium text-foreground/90"
        onCommit={onRename}
      />
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
        {childCount}
      </span>
    </RowShell>
  );
}

function VariableRow({
  variable,
  depth,
  parentFolderId,
  selected,
  onSelect,
  onRename,
  onDropCommit,
}: {
  variable: EndingVariable;
  depth: number;
  /** Folder this row currently lives in (null at root). Drives the
   *  insert-before/insert-after drop targets. By Ending view passes
   *  whatever the variable's persisted folder is — DnD is suppressed in
   *  that view by passing `onDropCommit=undefined`. */
  parentFolderId: string | null;
  selected: boolean;
  onSelect: (opts?: SelectOptions) => void;
  onRename: (name: string) => void;
  /** Optional — when omitted, the row is read-only with respect to DnD
   *  (used in By Ending view, which doesn't reorder anything). */
  onDropCommit?: () => void;
}) {
  const color = variable.color_hex ?? paletteColor(variable.color_index);
  return (
    <RowShell
      kind="variable"
      id={variable.id}
      parentFolderId={parentFolderId}
      selected={selected}
      onSelect={onSelect}
      paddingLeftPx={depth * 16 + 32}
      onDropCommit={onDropCommit}
    >
      <span
        aria-hidden
        className="block h-3 w-3 shrink-0 rounded-sm border border-border/60"
        style={{ backgroundColor: color }}
      />
      <RenamableLabel
        value={variable.name}
        placeholder="Unnamed variable"
        className="min-w-0 flex-1 truncate text-foreground/90"
        onCommit={onRename}
      />
    </RowShell>
  );
}

/** A list row chrome shared by folder + variable rows. Single click anywhere
 *  selects; shift+click extends the multi-selection. Double-click on the
 *  RenamableLabel enters rename mode. Row height is fixed so the input
 *  swap doesn't reflow the layout.
 *
 *  Drag-and-drop: every row is draggable (when `onDropCommit` is provided)
 *  and acts as a drop target. The drop target a row exposes depends on
 *  cursor Y inside the row:
 *    - top third  → insert BEFORE this row at the same parent level
 *    - middle (folder only) → drop INTO this folder
 *    - bottom third → insert AFTER this row at the same parent level
 *  For variable rows the middle band degrades to "after" since variables
 *  can't contain children. */
function RowShell({
  kind,
  id,
  parentFolderId,
  selected,
  onSelect,
  paddingLeftPx,
  onDropCommit,
  children,
}: {
  kind: DragKind;
  id: string;
  parentFolderId: string | null;
  selected: boolean;
  onSelect: (opts?: SelectOptions) => void;
  paddingLeftPx: number;
  /** When omitted, DnD is disabled on this row (used by By Ending view). */
  onDropCommit?: () => void;
  children: React.ReactNode;
}) {
  const drag = useDragCtx();
  const rowRef = useRef<HTMLDivElement>(null);
  const dndEnabled = onDropCommit !== undefined;
  const isSource = drag.source?.id === id;

  // Compute the proposed target from a dragover event over this row.
  function targetForEvent(e: React.DragEvent<HTMLDivElement>): DragTarget {
    const el = rowRef.current;
    if (!el) {
      return { parent_folder_id: parentFolderId, before_id: id, intoFolder: false };
    }
    const rect = el.getBoundingClientRect();
    const yFrac = (e.clientY - rect.top) / Math.max(1, rect.height);
    if (kind === "folder" && yFrac > 0.25 && yFrac < 0.75) {
      return { parent_folder_id: id, before_id: null, intoFolder: true };
    }
    if (yFrac < 0.5) {
      return { parent_folder_id: parentFolderId, before_id: id, intoFolder: false };
    }
    // After this row: before the *next* sibling. The server resolves
    // before_id=null as "end of group" — but if there is a next sibling
    // in the same parent, we can't know its id from here without more
    // wiring. Pass before_id=null and let the editor's commitDrop place
    // the row at the end relative to the local mirror's reorder pass.
    // For correct "drop between" behavior, the next row's "before" zone
    // will fire instead, so this fallback only matters at the end of a
    // group. (Tested: dragging onto the bottom half of the last row lands
    // the item at the bottom of the group, which is the desired outcome.)
    return { parent_folder_id: parentFolderId, before_id: null, intoFolder: false };
  }

  const target = drag.target;
  const isInsertBefore =
    target !== null &&
    !target.intoFolder &&
    target.parent_folder_id === parentFolderId &&
    target.before_id === id;
  // Highlight a folder row whenever the cursor is anywhere inside it,
  // including over its child rows or empty body. Innermost wins by
  // construction: the deepest hovered row sets target.parent_folder_id
  // to its own direct parent, so only that folder matches.
  const isIntoSelf =
    kind === "folder" && target !== null && target.parent_folder_id === id;

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      draggable={dndEnabled}
      onDragStart={(e) => {
        if (!dndEnabled) return;
        drag.start({ kind, id });
        e.dataTransfer.effectAllowed = "move";
        // Some browsers need a payload set; the value itself is unused.
        e.dataTransfer.setData("text/plain", id);
      }}
      onDragEnd={() => {
        if (!dndEnabled) return;
        drag.end();
      }}
      onDragOver={(e) => {
        if (!dndEnabled || !drag.source) return;
        if (drag.proposeTarget(targetForEvent(e))) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDragEnter={(e) => {
        if (!dndEnabled || !drag.source) return;
        if (drag.proposeTarget(targetForEvent(e))) {
          e.preventDefault();
        }
      }}
      onDrop={(e) => {
        if (!dndEnabled) return;
        e.preventDefault();
        onDropCommit?.();
      }}
      onClick={(e) => onSelect({ extend: e.shiftKey })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect({ extend: e.shiftKey });
        }
      }}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 border-t border-border px-3 text-sm transition-colors first:border-t-0 focus:outline-none",
        ROW_HEIGHT_CLS,
        // isIntoSelf wins over selection/hover so a folder you're about
        // to drop into reads as the unambiguous target.
        isIntoSelf
          ? "bg-accent text-accent-foreground shadow-[inset_0_0_0_2px_var(--color-foreground)]"
          : selected
            ? "bg-accent text-accent-foreground hover:bg-accent focus-visible:bg-accent"
            : "hover:bg-accent/20 focus-visible:bg-accent/20",
        isSource && "opacity-40"
      )}
      style={{ paddingLeft: `${paddingLeftPx}px` }}
    >
      {/* Insertion indicator above the row when this row is the
          "before-id" target. Absolute-positioned so it doesn't grow the
          row height. */}
      {isInsertBefore ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-px h-0.5 bg-accent"
        />
      ) : null}
      {children}
    </div>
  );
}

/** Label that swaps to an inline input on double-click. The input is sized
 *  to the same height as the row's flex line so the row height stays
 *  perfectly stable in/out of rename mode. */
function RenamableLabel({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: string;
  placeholder: string;
  className?: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft synced to the latest server value while we're NOT
  // actively editing. Render-time setState (vs. useEffect) so the new
  // react-hooks/set-state-in-effect rule stays happy.
  const [prevValue, setPrevValue] = useState(value);
  if (!editing && value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
  }

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function finish(save: boolean) {
    setEditing(false);
    if (save) {
      const trimmed = draft.trim();
      if (trimmed && trimmed !== value) onCommit(trimmed);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{ height: `${ROW_HEIGHT_PX - 8}px` }}
        className={cn(
          "min-w-0 flex-1 rounded-sm border border-border/60 bg-background/70 px-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent",
          className
        )}
      />
    );
  }

  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      className={className}
    >
      {value || placeholder}
    </span>
  );
}

function ByEndingView({
  panels,
  selectedIds,
  onSelect,
  isCollapsed,
  onToggleCollapsed,
  onRenameVariable,
}: {
  panels: Array<{ key: string; title: string; rows: EndingVariable[] }>;
  selectedIds: Set<string>;
  onSelect: (id: string, opts?: SelectOptions) => void;
  isCollapsed: (key: string) => boolean;
  onToggleCollapsed: (key: string) => void;
  onRenameVariable: (id: string, name: string) => void;
}) {
  if (panels.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        No variables yet.
      </p>
    );
  }
  return (
    <div>
      {panels.map((panel, idx) => {
        const collapsed = isCollapsed(panel.key);
        return (
          <section key={panel.key}>
            <button
              type="button"
              onClick={() => onToggleCollapsed(panel.key)}
              aria-expanded={!collapsed}
              // `first:border-t-0` would always match here (the button is
              // the first child of its <section>), dropping the divider on
              // every header. Gate on the panel index instead so we keep
              // the line between adjacent panels.
              className={cn(
                "flex w-full items-center gap-2 bg-muted/20 px-3 text-left transition-colors hover:bg-muted/30",
                idx > 0 && "border-t border-border",
                ROW_HEIGHT_CLS
              )}
            >
              <span
                aria-hidden
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
              >
                {collapsed ? (
                  <ChevronRight size={13} />
                ) : (
                  <ChevronDown size={13} />
                )}
              </span>
              <Folder
                size={12}
                aria-hidden
                className="shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {panel.title}
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                {panel.rows.length}
              </span>
            </button>
            {collapsed
              ? null
              : panel.rows.length === 0
                ? (
                  <div
                    className={cn(
                      "flex items-center border-t border-border px-3 text-xs italic text-muted-foreground/60",
                      ROW_HEIGHT_CLS
                    )}
                    style={{ paddingLeft: `${1 * 16 + 32}px` }}
                  >
                    None.
                  </div>
                )
                : panel.rows.map((v) => (
                    <VariableRow
                      key={`${panel.key}:${v.id}`}
                      variable={v}
                      depth={1}
                      // By Ending intentionally doesn't accept DnD —
                      // omit onDropCommit and the row falls back to
                      // selection-only behavior. parentFolderId is
                      // unused in that mode but still required by the
                      // shared signature.
                      parentFolderId={v.folder_id}
                      selected={selectedIds.has(v.id)}
                      onSelect={(opts) => onSelect(v.id, opts)}
                      onRename={(name) => onRenameVariable(v.id, name)}
                    />
                  ))}
          </section>
        );
      })}
    </div>
  );
}
