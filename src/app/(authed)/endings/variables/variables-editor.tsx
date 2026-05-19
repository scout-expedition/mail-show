"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
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
  patchEndingVariable,
  patchEndingVariableFolder,
} from "./actions";
import {
  VariableInspector,
  type FolderTreeOption,
} from "./variable-inspector";
import { FolderInspector } from "./folder-inspector";
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
  // new ones, drop removed ones.
  useEffect(() => {
    setVariables((prev) => reconcileById(prev, initialVariables));
  }, [initialVariables]);
  useEffect(() => {
    setValues((prev) => reconcileById(prev, initialValues));
  }, [initialValues]);
  useEffect(() => {
    setFolders((prev) => reconcileById(prev, initialFolders));
  }, [initialFolders]);

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

  // URL deep-link: ?variable=<id> / ?folder=<id> hydrate selection. Only
  // synced back to the URL when exactly one item is selected.
  const initialSelectedIds = useMemo(() => {
    const v = searchParams.get("variable");
    if (v) return new Set([v]);
    const f = searchParams.get("folder");
    if (f) return new Set([f]);
    return new Set<string>();
  }, [searchParams]);
  const [selectedIds, setSelectedIds] =
    useState<Set<string>>(initialSelectedIds);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  const syncUrl = useCallback(
    (ids: Set<string>) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("variable");
      params.delete("folder");
      if (ids.size === 1) {
        const [only] = Array.from(ids);
        if (variables.some((v) => v.id === only)) params.set("variable", only);
        else if (folders.some((f) => f.id === only)) params.set("folder", only);
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
  // itself.
  const buildFolderOptions = useCallback(
    (excludedIds: ReadonlyArray<string>): FolderTreeOption[] => {
      const excluded = new Set<string>(excludedIds);
      const queue: string[] = [...excludedIds];
      while (queue.length > 0) {
        const next = queue.shift()!;
        for (const child of childFoldersByParent.get(next) ?? []) {
          if (!excluded.has(child.id)) {
            excluded.add(child.id);
            queue.push(child.id);
          }
        }
      }
      const out: FolderTreeOption[] = [];
      function visit(parentId: string | null, depth: number) {
        const children = childFoldersByParent.get(parentId) ?? [];
        for (const f of children) {
          if (excluded.has(f.id)) continue;
          out.push({
            id: f.id,
            label: `${" ".repeat(depth)}${f.name}`,
          });
          visit(f.id, depth + 1);
        }
      }
      visit(null, 0);
      return out;
    },
    [childFoldersByParent]
  );

  const allFolderOptions = useMemo<FolderTreeOption[]>(
    () => buildFolderOptions([]),
    [buildFolderOptions]
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

  function handleDeleted(_id: string) {
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

  // Drop a single-selection id that vanished from the data.
  useEffect(() => {
    if (!isSingle || singleId === null) return;
    if (!selectedVariable && !selectedFolder) {
      clearSelection();
    }
  }, [isSingle, singleId, selectedVariable, selectedFolder, clearSelection]);

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
        Array.from(selectedIds).filter((id) =>
          folders.some((f) => f.id === id)
        )
      ),
    [selectedIds, folders, buildFolderOptions]
  );

  // Single-selection inspector — exclude the selected folder + descendants
  // from its parent picker so it can't be set as its own ancestor.
  const singleFolderOptions = useMemo(
    () =>
      selectedFolder
        ? buildFolderOptions([selectedFolder.id])
        : buildFolderOptions([]),
    [selectedFolder, buildFolderOptions]
  );

  return (
    <>
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
        <div className="sticky top-4 min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card">
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
    </>
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
}) {
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
          childFoldersByParent={childFoldersByParent}
          sortedVariablesByFolder={sortedVariablesByFolder}
          isCollapsed={isCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onRenameVariable={onRenameVariable}
          onRenameFolder={onRenameFolder}
        />
      ) : null}
      {rootFolders
        .filter((f) => f.id !== pinnedId)
        .map((f) => (
          <FolderBranch
            key={f.id}
            folder={f}
            depth={0}
            childFoldersByParent={childFoldersByParent}
            sortedVariablesByFolder={sortedVariablesByFolder}
            isCollapsed={isCollapsed}
            onToggleCollapsed={onToggleCollapsed}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onRenameVariable={onRenameVariable}
            onRenameFolder={onRenameFolder}
          />
        ))}
      {rootVariables.map((v) => (
        <VariableRow
          key={v.id}
          variable={v}
          depth={0}
          selected={selectedIds.has(v.id)}
          onSelect={(opts) => onSelect(v.id, opts)}
          onRename={(name) => onRenameVariable(v.id, name)}
        />
      ))}
    </div>
  );
}

function FolderBranch({
  folder,
  depth,
  childFoldersByParent,
  sortedVariablesByFolder,
  isCollapsed,
  onToggleCollapsed,
  selectedIds,
  onSelect,
  onRenameVariable,
  onRenameFolder,
}: {
  folder: EndingVariableFolder;
  depth: number;
  childFoldersByParent: Map<string | null, EndingVariableFolder[]>;
  sortedVariablesByFolder: Map<string | null, EndingVariable[]>;
  isCollapsed: (id: string) => boolean;
  onToggleCollapsed: (id: string) => void;
  selectedIds: Set<string>;
  onSelect: (id: string, opts?: SelectOptions) => void;
  onRenameVariable: (id: string, name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
}) {
  const collapsed = isCollapsed(folder.id);
  const childFolders = childFoldersByParent.get(folder.id) ?? [];
  const childVariables = sortedVariablesByFolder.get(folder.id) ?? [];
  const totalChildren = childFolders.length + childVariables.length;
  return (
    <>
      <FolderRow
        folder={folder}
        depth={depth}
        collapsed={collapsed}
        childCount={totalChildren}
        selected={selectedIds.has(folder.id)}
        onSelect={(opts) => onSelect(folder.id, opts)}
        onToggle={() => onToggleCollapsed(folder.id)}
        onRename={(name) => onRenameFolder(folder.id, name)}
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
                childFoldersByParent={childFoldersByParent}
                sortedVariablesByFolder={sortedVariablesByFolder}
                isCollapsed={isCollapsed}
                onToggleCollapsed={onToggleCollapsed}
                selectedIds={selectedIds}
                onSelect={onSelect}
                onRenameVariable={onRenameVariable}
                onRenameFolder={onRenameFolder}
              />
            ))}
            {childVariables.map((v) => (
              <VariableRow
                key={v.id}
                variable={v}
                depth={depth + 1}
                selected={selectedIds.has(v.id)}
                onSelect={(opts) => onSelect(v.id, opts)}
                onRename={(name) => onRenameVariable(v.id, name)}
              />
            ))}
            {totalChildren === 0 ? (
              <div
                className={cn(
                  "flex items-center border-t border-border text-[11px] italic text-muted-foreground/60",
                  ROW_HEIGHT_CLS
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
  collapsed,
  childCount,
  selected,
  onSelect,
  onToggle,
  onRename,
}: {
  folder: EndingVariableFolder;
  depth: number;
  collapsed: boolean;
  childCount: number;
  selected: boolean;
  onSelect: (opts?: SelectOptions) => void;
  onToggle: () => void;
  onRename: (name: string) => void;
}) {
  return (
    <RowShell
      selected={selected}
      onSelect={onSelect}
      paddingLeftPx={depth * 16 + 8}
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
  selected,
  onSelect,
  onRename,
}: {
  variable: EndingVariable;
  depth: number;
  selected: boolean;
  onSelect: (opts?: SelectOptions) => void;
  onRename: (name: string) => void;
}) {
  const color = variable.color_hex ?? paletteColor(variable.color_index);
  return (
    <RowShell
      selected={selected}
      onSelect={onSelect}
      paddingLeftPx={depth * 16 + 32}
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
 *  swap doesn't reflow the layout. */
function RowShell({
  selected,
  onSelect,
  paddingLeftPx,
  children,
}: {
  selected: boolean;
  onSelect: (opts?: SelectOptions) => void;
  paddingLeftPx: number;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => onSelect({ extend: e.shiftKey })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect({ extend: e.shiftKey });
        }
      }}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 border-t border-border px-3 text-sm transition-colors first:border-t-0 focus:outline-none",
        ROW_HEIGHT_CLS,
        // Selected wins over hover. Use solid accent so shift-clicking
        // multiple rows reads at a glance, even against dark panel chrome.
        selected
          ? "bg-accent text-accent-foreground hover:bg-accent focus-visible:bg-accent"
          : "hover:bg-accent/20 focus-visible:bg-accent/20"
      )}
      style={{ paddingLeft: `${paddingLeftPx}px` }}
    >
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

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

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
