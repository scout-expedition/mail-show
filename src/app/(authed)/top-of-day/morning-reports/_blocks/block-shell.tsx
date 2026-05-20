"use client";

// Shared collapsible-card chrome for every Morning Reports block. Mirrors
// the visual structure of the endings TextBlock (drag grip · collapse
// chevron · leading pill · header slot · overflow menu) but for the flat
// 3-zone morning-report layout instead of the endings condition tree.

import { ChevronDown, ChevronRight, GripVertical, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Drag coordination handed down from the editor to each draggable block. */
export type DragApi = {
  draggingId: string | null;
  targetId: string | null;
  targetPos: "before" | "after" | null;
  start: (id: string) => void;
  over: (id: string, e: React.DragEvent) => void;
  drop: () => void;
  end: () => void;
};

/** Thin blue insertion indicator shown above/below a drop target. */
export function DropLine({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none my-0.5 h-1 rounded-full transition-colors"
      style={{ backgroundColor: active ? "rgb(96 165 250)" : "transparent" }}
    />
  );
}

export function BlockFrame({
  dragId,
  drag,
  collapsed,
  onToggleCollapse,
  leading,
  headerExtra,
  menu,
  children,
  nested,
}: {
  /** Set together with `drag` to make the card draggable + show drop lines. */
  dragId?: string;
  drag?: DragApi;
  collapsed: boolean;
  onToggleCollapse: () => void;
  leading: React.ReactNode;
  headerExtra?: React.ReactNode;
  menu?: React.ReactNode;
  children: React.ReactNode;
  nested?: boolean;
}) {
  const draggable = Boolean(dragId && drag);
  const isDragging = draggable && drag!.draggingId === dragId;
  const isTarget =
    draggable && drag!.targetId === dragId && drag!.draggingId !== dragId;
  const showBefore = isTarget && drag!.targetPos === "before";
  const showAfter = isTarget && drag!.targetPos === "after";

  return (
    <div className="flex flex-col">
      {draggable ? <DropLine active={showBefore} /> : null}
      <div
        onDragOver={
          draggable
            ? (e) => {
                // Always preventDefault so the card is a valid drop target
                // even before the dragging-state re-render lands.
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                drag!.over(dragId!, e);
              }
            : undefined
        }
        onDrop={
          draggable
            ? (e) => {
                e.preventDefault();
                drag!.drop();
              }
            : undefined
        }
        className={cn(
          "group/block rounded-md border border-border transition-opacity",
          nested ? "bg-white/[0.02]" : "bg-card",
          isDragging && "opacity-40"
        )}
      >
        <div className="flex items-center gap-1 px-2 py-1.5">
          {draggable ? (
            <span
              aria-hidden
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", dragId!);
                drag!.start(dragId!);
              }}
              onDragEnd={() => drag!.end()}
              className="-ml-1 cursor-grab text-muted-foreground/30 transition-colors hover:text-muted-foreground"
            >
              <GripVertical size={14} />
            </span>
          ) : null}
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand" : "Collapse"}
            aria-expanded={!collapsed}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground"
          >
            {collapsed ? (
              <ChevronRight size={14} aria-hidden />
            ) : (
              <ChevronDown size={14} aria-hidden />
            )}
          </button>
          {leading}
          {headerExtra ? (
            <div className="min-w-0 flex-1">{headerExtra}</div>
          ) : (
            <div className="flex-1" />
          )}
          {menu}
        </div>
        {collapsed ? null : (
          <div className="flex flex-col gap-2 px-2 pb-2">{children}</div>
        )}
      </div>
      {draggable ? <DropLine active={showAfter} /> : null}
    </div>
  );
}

/** Section header inside a block body (e.g. "Trigger"). */
export function BlockSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Small in-header text input for summaries / names. Matches the endings
 * text-block summary field — 10px, foreground text, muted placeholder.
 * The `!` prefixes defeat the global `input { font: inherit }` rule.
 */
export function HeaderInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      {...props}
      className={cn(
        "w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 !text-[10px] font-normal normal-case tracking-normal text-foreground placeholder:!text-muted-foreground/40 focus:border-border focus:shadow-sm focus:outline-none",
        props.className
      )}
    />
  );
}

/** Static title shown in a pinned block header in place of an input. */
export function HeaderTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1 !text-[10px] font-normal normal-case tracking-normal text-foreground">
      {children}
    </span>
  );
}

/**
 * Hover-revealed "+" insert target between two top-level blocks. A bare
 * dashed "+" button, like the endings InsertionZone. `alwaysVisible` keeps
 * it shown for the empty-state slot and once an add has started.
 */
export function InsertZone({
  onAdd,
  disabled,
  alwaysVisible,
}: {
  onAdd: () => void;
  disabled?: boolean;
  alwaysVisible?: boolean;
}) {
  return (
    <div className="group/zone relative flex h-7 items-center justify-center">
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        aria-label="Add report segment"
        title="Add report segment"
        className={cn(
          "inline-flex h-5 w-10 items-center justify-center rounded-md border border-dashed border-[var(--block-border)] text-muted-foreground transition-[opacity,background-color,border-color] duration-200 hover:border-solid hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed",
          alwaysVisible
            ? "opacity-100"
            : "opacity-0 group-hover/zone:opacity-100 focus-within:opacity-100"
        )}
      >
        <Plus size={12} aria-hidden />
      </button>
    </div>
  );
}
