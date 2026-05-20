"use client";

// Nested folder tree shared by `/endings/variables` and
// `/endings/smart-variables`. Each page owns its own state (variables,
// folders, selection, drag commit) and passes it in via props + a drag
// context value. The components here are presentation + DnD bookkeeping;
// the actual server actions are wired by the calling page.
//
// Coupling notes:
//   - `RowShell` calls `useDragCtx()` unconditionally — every caller must
//     wrap the tree in `<DragProvider value={...}>` (even when DnD is
//     effectively disabled, pass a valid drag context). The Variables page
//     wraps the whole editor; the Smart Variables page does the same.
//   - Density-driven sizing (font + padding) is gated by the `density`
//     prop. The Variables page uses 'comfortable' (text-sm, larger
//     padding); the Smart Variables narrow rail uses 'compact' (text-xs,
//     tighter padding) so the tree fits at lg:w-72.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { paletteColor } from "@/lib/endings/color-palette";
import type { EndingVariable, EndingVariableFolder } from "@/lib/db/types";

export type SelectOptions = { extend?: boolean };
export type Density = "comfortable" | "compact";

export type DragKind = "variable" | "folder";
export type DragSource = { kind: DragKind; id: string };
/** Where the dragged row would land if released now. `intoFolder=true`
 *  means "drop into the folder body" (parent_folder_id set to that
 *  folder, inserted at the end of its children); otherwise we're
 *  inserting before the `before_id` sibling (or at the end of the group
 *  when null). */
export type DragTarget = {
  parent_folder_id: string | null;
  before_id: string | null;
  intoFolder: boolean;
};
export type DragContextValue = {
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
export function useDragCtx(): DragContextValue {
  const ctx = useContext(DragCtx);
  if (!ctx) throw new Error("DragCtx missing");
  return ctx;
}
export function DragProvider({
  value,
  children,
}: {
  value: DragContextValue;
  children: ReactNode;
}) {
  return <DragCtx.Provider value={value}>{children}</DragCtx.Provider>;
}

/** Fixed row height across the tree so renaming an item doesn't jiggle
 *  the layout. 28px ≈ comfortable click target without feeling spread
 *  out. Same height used for variable rows, folder rows, the inline
 *  rename input, and the tail-drop zone. */
export const ROW_HEIGHT_PX = 28;
export const ROW_HEIGHT_CLS = "h-7";

type DensityConfig = {
  rowTextCls: string;
  rowPaddingXCls: string;
  /** Per-depth indent in pixels — multiplied by depth to compute padding-left. */
  indentPx: number;
  /** Extra left padding for variable rows (so they sit past the folder
   *  chevron column). Added on top of `depth * indentPx`. */
  variableExtraPx: number;
  /** Left padding for folder rows on top of `depth * indentPx`. */
  folderExtraPx: number;
  chevronSize: number;
  folderIconSize: number;
  swatchPx: number;
};

const DENSITY: Record<Density, DensityConfig> = {
  comfortable: {
    rowTextCls: "text-sm",
    rowPaddingXCls: "px-3",
    indentPx: 16,
    variableExtraPx: 32,
    folderExtraPx: 8,
    chevronSize: 14,
    folderIconSize: 13,
    swatchPx: 12,
  },
  compact: {
    rowTextCls: "text-[12px]",
    rowPaddingXCls: "px-2",
    indentPx: 12,
    variableExtraPx: 24,
    folderExtraPx: 4,
    chevronSize: 12,
    folderIconSize: 11,
    swatchPx: 10,
  },
};

export type FolderTreeViewProps = {
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
  density?: Density;
  emptyMessage?: string;
};

/** Renders the full nested-folder tree at depth 0. */
export function FolderTreeView({
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
  density = "comfortable",
  emptyMessage = "No variables or folders yet.",
}: FolderTreeViewProps) {
  const drag = useDragCtx();
  const rootFolders = childFoldersByParent.get(null) ?? [];
  const rootVariables = sortedVariablesByFolder.get(null) ?? [];

  if (folders.length === 0 && rootVariables.length === 0) {
    return (
      <p
        className={cn(
          "px-4 py-6 text-center text-muted-foreground",
          density === "compact" ? "text-[11px]" : "text-sm"
        )}
      >
        {emptyMessage}
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
          density={density}
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
            density={density}
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
          density={density}
        />
      ))}
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
        "border-t border-border transition-colors h-3",
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
  density = "comfortable",
}: {
  folder: EndingVariableFolder;
  depth: number;
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
  density?: Density;
}) {
  const cfg = DENSITY[density];
  const drag = useDragCtx();
  const collapsed = isCollapsed(folder.id);
  const childFolders = childFoldersByParent.get(folder.id) ?? [];
  const childVariables = sortedVariablesByFolder.get(folder.id) ?? [];
  const totalChildren = childFolders.length + childVariables.length;
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
        density={density}
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
                density={density}
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
                density={density}
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
                  "flex items-center border-t border-border italic text-muted-foreground/60 transition-colors",
                  ROW_HEIGHT_CLS,
                  emptyZoneActive && "bg-accent/30"
                )}
                style={{
                  paddingLeft: `${(depth + 1) * cfg.indentPx + cfg.variableExtraPx}px`,
                  fontSize: "11px",
                }}
              >
                empty
              </div>
            ) : null}
          </>
        )}
    </>
  );
}

export function FolderRow({
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
  density = "comfortable",
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
  density?: Density;
}) {
  const cfg = DENSITY[density];
  return (
    <RowShell
      kind="folder"
      id={folder.id}
      parentFolderId={parentFolderId}
      selected={selected}
      onSelect={onSelect}
      paddingLeftPx={depth * cfg.indentPx + cfg.folderExtraPx}
      onDropCommit={onDropCommit}
      density={density}
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
          <ChevronRight size={cfg.chevronSize} aria-hidden />
        ) : (
          <ChevronDown size={cfg.chevronSize} aria-hidden />
        )}
      </span>
      {collapsed ? (
        <Folder
          size={cfg.folderIconSize}
          aria-hidden
          className="shrink-0 text-muted-foreground"
        />
      ) : (
        <FolderOpen
          size={cfg.folderIconSize}
          aria-hidden
          className="shrink-0 text-muted-foreground"
        />
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

export function VariableRow({
  variable,
  depth,
  parentFolderId,
  selected,
  onSelect,
  onRename,
  onDropCommit,
  density = "comfortable",
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
  /** Optional — when omitted, the row is read-only with respect to DnD. */
  onDropCommit?: () => void;
  density?: Density;
}) {
  const cfg = DENSITY[density];
  const color = variable.color_hex ?? paletteColor(variable.color_index);
  return (
    <RowShell
      kind="variable"
      id={variable.id}
      parentFolderId={parentFolderId}
      selected={selected}
      onSelect={onSelect}
      paddingLeftPx={depth * cfg.indentPx + cfg.variableExtraPx}
      onDropCommit={onDropCommit}
      density={density}
    >
      <span
        aria-hidden
        className="block shrink-0 rounded-sm border border-border/60"
        style={{
          width: `${cfg.swatchPx}px`,
          height: `${cfg.swatchPx}px`,
          backgroundColor: color,
        }}
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

/** Shared row chrome (selection, drag/drop, padding). Single click
 *  selects, shift+click extends; double-click on the label enters
 *  rename. Drop targets are derived from cursor Y within the row:
 *    - top half  → insert BEFORE this row at the same parent level
 *    - middle (folder only) → drop INTO this folder
 *    - bottom    → insert AFTER this row (resolves to end-of-group). */
function RowShell({
  kind,
  id,
  parentFolderId,
  selected,
  onSelect,
  paddingLeftPx,
  onDropCommit,
  density = "comfortable",
  children,
}: {
  kind: DragKind;
  id: string;
  parentFolderId: string | null;
  selected: boolean;
  onSelect: (opts?: SelectOptions) => void;
  paddingLeftPx: number;
  onDropCommit?: () => void;
  density?: Density;
  children: ReactNode;
}) {
  const cfg = DENSITY[density];
  const drag = useDragCtx();
  const rowRef = useRef<HTMLDivElement>(null);
  const dndEnabled = onDropCommit !== undefined;
  const isSource = drag.source?.id === id;

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
    return { parent_folder_id: parentFolderId, before_id: null, intoFolder: false };
  }

  const target = drag.target;
  const isInsertBefore =
    target !== null &&
    !target.intoFolder &&
    target.parent_folder_id === parentFolderId &&
    target.before_id === id;
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
        "relative flex cursor-pointer select-none items-center gap-2 border-t border-border transition-colors first:border-t-0 focus:outline-none",
        cfg.rowPaddingXCls,
        cfg.rowTextCls,
        ROW_HEIGHT_CLS,
        isIntoSelf
          ? "bg-accent text-accent-foreground shadow-[inset_0_0_0_2px_var(--color-foreground)]"
          : selected
            ? "bg-accent text-accent-foreground hover:bg-accent focus-visible:bg-accent"
            : "hover:bg-accent/20 focus-visible:bg-accent/20",
        isSource && "opacity-40"
      )}
      style={{ paddingLeft: `${paddingLeftPx}px` }}
    >
      {isInsertBefore ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-[2px] z-10 h-[3px] rounded-full bg-primary shadow-[0_0_0_1px_var(--color-background)]"
        />
      ) : null}
      {children}
    </div>
  );
}

export function RenamableLabel({
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
          "min-w-0 flex-1 rounded-sm border border-border/60 bg-background/70 px-1 text-foreground focus:outline-none focus:ring-1 focus:ring-accent",
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
