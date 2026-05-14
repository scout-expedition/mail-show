"use client";

import { useRef, useTransition } from "react";
import {
  AlignLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Trash2,
} from "lucide-react";
import { AutoTextarea, OverflowMenu } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { BlockState } from "@/lib/endings/block-state";
import { useDrag, type DragTarget } from "../_shared/lib/drag";
import { useCollapseCtx } from "../_shared/lib/total-collapse";
import { duplicateBlock } from "../_shared/document-actions";
import { useConfirm } from "@/components/confirm-dialog";

export function TextBlock({
  block,
  onChange,
  onChangeSummary,
  onDelete,
}: {
  block: BlockState;
  onChange: (text: string) => void;
  onChangeSummary: (summary: string) => void;
  onDelete: () => void;
}) {
  const [, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useDrag();
  const collapseCtx = useCollapseCtx();
  const override = collapseCtx.overrides.get(block.id);
  const panelCollapsed = collapseCtx.mode !== "expanded";
  const collapsed = override ?? panelCollapsed;
  const handleToggleCollapsed = () => {
    collapseCtx.setOverride(block.id, !collapsed);
  };
  const isDragging = drag.dragId === block.id;
  const targetBefore =
    drag.target?.kind === "near" &&
    drag.target.targetId === block.id &&
    drag.target.position === "before";
  const targetAfter =
    drag.target?.kind === "near" &&
    drag.target.targetId === block.id &&
    drag.target.position === "after";

  function nearTarget(e: React.DragEvent): DragTarget {
    const rect = e.currentTarget.getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    return {
      kind: "near",
      parent_block_id: block.parent_block_id,
      parent_row_id: block.parent_row_id,
      targetId: block.id,
      position,
    };
  }

  return (
    <div ref={ref} className="relative flex flex-1 flex-col">
      <DropLine active={targetBefore} side="top" />
      <div
        ref={cardRef}
        onDragEnter={(e) => {
          if (!drag.dragId) return;
          e.preventDefault();
          e.stopPropagation();
          if (drag.dragId === block.id) return;
          drag.setTarget(nearTarget(e));
        }}
        onDragOver={(e) => {
          if (!drag.dragId) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          if (drag.dragId === block.id) return;
          drag.setTarget(nearTarget(e));
        }}
        onDrop={(e) => {
          if (!drag.dragId) return;
          e.preventDefault();
          e.stopPropagation();
          if (drag.dragId === block.id) return;
          drag.commit();
        }}
        className={cn(
          "group/textblock relative flex h-full min-h-full flex-1 flex-col rounded-md border border-[var(--block-border)] p-2 transition-colors",
          isDragging && "opacity-40"
        )}
        style={{ backgroundColor: "var(--block-card)" }}
      >
        <div className={cn("group/header flex items-center gap-2 px-0", collapsed ? "pb-0" : "pb-2")}>
          <div className="flex shrink-0 items-center gap-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            <span
              aria-hidden
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                drag.start(block.id, cardRef.current?.offsetHeight ?? 0);
                e.dataTransfer.effectAllowed = "move";
                if (cardRef.current) {
                  const rect = cardRef.current.getBoundingClientRect();
                  e.dataTransfer.setDragImage(
                    cardRef.current,
                    e.clientX - rect.left,
                    e.clientY - rect.top
                  );
                }
              }}
              className="-ml-1 -mr-0.5 cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover/header:opacity-100"
            >
              <GripVertical size={14} />
            </span>
            <button
              type="button"
              onClick={handleToggleCollapsed}
              aria-label={collapsed ? "Expand text block" : "Collapse text block"}
              aria-expanded={!collapsed}
              title={collapsed ? "Expand" : "Collapse"}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground"
            >
              {collapsed ? (
                <ChevronRight size={14} aria-hidden />
              ) : (
                <ChevronDown size={14} aria-hidden />
              )}
            </button>
            <AlignLeft
              size={14}
              aria-label="Text block"
              className="text-muted-foreground/70"
            />
          </div>
          <input
            type="text"
            value={block.summary}
            onChange={(e) => onChangeSummary(e.target.value)}
            placeholder="Summary…"
            aria-label="Block summary"
            className="flex-1 min-w-0 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-normal normal-case tracking-normal text-foreground placeholder:text-muted-foreground/60 focus:border-border focus:shadow-sm focus:outline-none"
          />
          <div className="flex shrink-0 items-center gap-2">
            <OverflowMenu
              items={[
                {
                  label: "Duplicate Text Block",
                  icon: <Copy size={10} aria-hidden />,
                  onClick: () => {
                    startTransition(async () => {
                      await duplicateBlock({ id: block.id });
                    });
                  },
                },
                {
                  label: "Delete Text Block",
                  intent: "destructive",
                  icon: <Trash2 size={10} aria-hidden />,
                  onClick: async () => {
                    const ok = await confirm({
                      title: "Delete text block?",
                      message: "This can't be undone.",
                      confirmLabel: "Delete",
                      intent: "destructive",
                    });
                    if (ok) onDelete();
                  },
                },
              ]}
            />
          </div>
        </div>
        {collapsed ? null : (
          <AutoTextarea
            value={block.text}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Paragraph text…"
            style={{
              fontVariantLigatures: "none",
              backgroundColor: "var(--block-result-bg)",
            }}
            className={cn(
              "flex-1 min-h-[2.25rem] !text-sm border-transparent shadow-none focus:border-border focus-visible:shadow-sm"
            )}
          />
        )}
      </div>
      <DropLine active={targetAfter} side="bottom" />
      {confirmDialog}
    </div>
  );
}

export function DropLine({
  active,
  side,
}: {
  active: boolean;
  side: "top" | "bottom";
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 right-0 h-1 transition-colors"
      style={{
        [side]: "-4px",
        backgroundColor: active ? "rgb(96 165 250)" : "transparent",
        borderRadius: 999,
      }}
    />
  );
}
