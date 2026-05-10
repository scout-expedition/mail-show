"use client";

import { useRef, useTransition } from "react";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import { AutoTextarea, OverflowMenu } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { BlockState } from "@/lib/endings/block-state";
import { useDrag, type DragTarget } from "../_shared/lib/drag";
import { duplicateBlock } from "../_shared/document-actions";
import { useConfirm } from "@/components/confirm-dialog";

export function TextBlock({
  block,
  onChange,
  onDelete,
}: {
  block: BlockState;
  onChange: (text: string) => void;
  onDelete: () => void;
}) {
  const [, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useDrag();
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
    <div ref={ref} className="relative">
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
          "group/textblock relative flex items-start gap-0.5 rounded-md border border-[var(--block-border)] px-0.5 py-1 transition-colors",
          isDragging && "opacity-40"
        )}
        style={{ backgroundColor: "var(--block-card)" }}
      >
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
          className="mt-1 cursor-grab text-muted-foreground/40 transition-opacity opacity-0 group-hover/textblock:opacity-100"
        >
          <GripVertical size={14} />
        </span>
        <AutoTextarea
          value={block.text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paragraph text…"
          // Disable programming ligatures so authors see the characters they
          // typed (e.g. `<=` doesn't auto-combine into `⩽`).
          style={{
            fontVariantLigatures: "none",
            backgroundColor: "var(--block-result-bg)",
          }}
          className={cn(
            "flex-1 min-h-[2.25rem] !text-sm border-transparent shadow-none focus:border-border focus-visible:shadow-sm"
          )}
        />
        <div className="opacity-0 transition-opacity group-hover/textblock:opacity-100 focus-within:opacity-100">
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
