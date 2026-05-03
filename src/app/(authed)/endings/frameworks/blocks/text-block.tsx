"use client";

import { useRef } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { AutoTextarea, GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import type { BlockState } from "@/lib/endings/block-state";
import { useDrag } from "../lib/drag";

export function TextBlock({
  block,
  onChange,
  onDelete,
}: {
  block: BlockState;
  onChange: (text: string) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDrag();
  const isDragging = drag.dragId === block.id;

  return (
    <div
      ref={ref}
      draggable
      onDragStart={(e) => {
        drag.start(block.id, ref.current?.offsetHeight ?? 0);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={drag.end}
      onDragOver={(e) => {
        e.preventDefault();
        drag.overBlock(
          {
            parent_block_id: block.parent_block_id,
            parent_row_id: block.parent_row_id,
          },
          block.id
        );
      }}
      className={cn(
        "group/textblock relative flex items-start gap-1 rounded-md border border-transparent bg-card transition-colors hover:border-border",
        isDragging && "opacity-40"
      )}
    >
      <span
        aria-hidden
        className="mt-2 cursor-grab text-muted-foreground/40 transition-opacity opacity-0 group-hover/textblock:opacity-100"
      >
        <GripVertical size={14} />
      </span>
      <AutoTextarea
        value={block.text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paragraph text…"
        // Disable programming ligatures so authors see the characters they
        // typed (e.g. `<=` doesn't auto-combine into `⩽`).
        style={{ fontVariantLigatures: "none" }}
        className={cn("flex-1 min-h-[2.25rem] !text-sm", GHOST_FIELD)}
      />
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete block"
        title="Delete block"
        className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-opacity opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover/textblock:opacity-100"
      >
        <Trash2 size={12} aria-hidden />
      </button>
    </div>
  );
}
