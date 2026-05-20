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
import { OverflowMenu } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { BlockState, VariableState } from "@/lib/endings/block-state";
import type { EndingVariableFolder } from "@/lib/db/types";
import { useDrag, type DragTarget } from "../_shared/lib/drag";
import { useCollapseCtx } from "../_shared/lib/total-collapse";
import { duplicateBlock, patchBlock } from "../_shared/document-actions";
import { useConfirm } from "@/components/confirm-dialog";
import { LexicalTextBlockEditor } from "./lexical/text-block-editor";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useMemo } from "react";

export function TextBlock({
  block,
  onDelete,
  variables,
  folders,
}: {
  block: BlockState;
  onDelete: () => void;
  variables: VariableState[];
  folders: EndingVariableFolder[];
}) {
  const { peers, setFocus } = usePresenceContext();

  // Drag highlight: presence focus on field="drag" indicates a peer (or
  // self) is currently dragging this block. Same focusKey used in the
  // FieldHighlight wrapper below.
  const dragFocusKey = useMemo(
    () => ({
      table: "ending_blocks",
      recordId: block.id,
      field: "drag",
    }),
    [block.id]
  );

  // text + summary commit independently — each owns its own debounce.
  // The hook's value prop comes from the parent mirror (block.text /
  // block.summary), which postgres echo keeps in sync. LWW protects
  // local typing from being clobbered by remote updates mid-edit.
  const textField = useInstantField<string>({
    value: block.text,
    onCommit: (v) => patchBlock(block.id, { text: v }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "ending_blocks", recordId: block.id, field: "text" }
          : null
      ),
  });
  const summaryField = useInstantField<string>({
    value: block.summary,
    onCommit: (v) => patchBlock(block.id, { summary: v }),
    onFocusChange: (focused) =>
      setFocus(
        focused
          ? { table: "ending_blocks", recordId: block.id, field: "summary" }
          : null
      ),
  });
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
      <FieldHighlight
        peers={peers}
        focusKey={dragFocusKey}
        className="flex flex-1 flex-col"
      >
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
        <div className={cn("group/header flex items-center gap-1 px-0", collapsed ? "pb-0" : "pb-2")}>
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
          <FieldHighlight
            peers={peers}
            focusKey={{
              table: "ending_blocks",
              recordId: block.id,
              field: "summary",
            }}
            className="flex-1 min-w-0"
          >
            <input
              type="text"
              value={summaryField.value}
              onChange={(e) => summaryField.set(e.target.value)}
              onFocus={summaryField.onFocus}
              onBlur={summaryField.onBlur}
              placeholder="Summary…"
              aria-label="Block summary"
              className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 !text-[10px] font-normal normal-case tracking-normal text-foreground placeholder:!text-muted-foreground/40 focus:border-border focus:shadow-sm focus:outline-none"
            />
          </FieldHighlight>
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
          <FieldHighlight
            peers={peers}
            focusKey={{
              table: "ending_blocks",
              recordId: block.id,
              field: "text",
            }}
          >
            <LexicalTextBlockEditor
              value={textField.value}
              onChange={textField.set}
              onFocus={textField.onFocus}
              onBlur={textField.onBlur}
              variables={variables}
              folders={folders}
              placeholder="Paragraph text…"
            />
          </FieldHighlight>
        )}
      </div>
      </FieldHighlight>
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
