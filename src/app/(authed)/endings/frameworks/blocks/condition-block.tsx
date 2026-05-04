"use client";

import { useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronLeft, GripVertical, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BlockState,
  ChipState,
  RowState,
  VariableState,
} from "@/lib/endings/block-state";
import type { EndingVariableValue } from "@/lib/db/types";
import { addChip, addRow, removeChip, removeRow } from "../actions";
import { useDrag, type DragTarget } from "../lib/drag";
import { AddChipButton, ChipPill, type AddChipInput } from "./chip";
import { DropLine } from "./text-block";

export function ConditionBlock({
  block,
  rows,
  chipsByRow,
  variableIndex,
  variables,
  values,
  onDeleteBlock,
  onChangeChip,
  renderRowContent,
}: {
  block: BlockState;
  rows: RowState[];
  chipsByRow: Map<string, ChipState[]>;
  variableIndex: Map<string, VariableState>;
  variables: VariableState[];
  values: EndingVariableValue[];
  onDeleteBlock: () => void;
  onChangeChip: (chipId: string, patch: Partial<ChipState>) => void;
  /** Render the recursive child-block list for a given row. */
  renderRowContent: (row: RowState) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useDrag();
  const isDragging = drag.dragId === block.id;
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(false);
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

  function handleAddRow() {
    startTransition(async () => {
      await addRow({ condition_block_id: block.id });
    });
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
          "group/condition relative rounded-md border border-border bg-muted/20 p-2",
          isDragging && "opacity-40"
        )}
      >
      <div className={cn("flex items-center justify-between gap-2 px-1", collapsed ? "pb-0" : "pb-2") }>
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
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
            className="cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover/condition:opacity-100"
          >
            <GripVertical size={12} />
          </span>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand condition block" : "Collapse condition block"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand" : "Collapse"}
            className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground"
          >
            {collapsed ? (
              <ChevronLeft size={12} aria-hidden />
            ) : (
              <ChevronDown size={12} aria-hidden />
            )}
          </button>
          Condition · {rows.length} {rows.length === 1 ? "row" : "rows"}
        </div>
        <button
          type="button"
          onClick={onDeleteBlock}
          aria-label="Delete condition block"
          title="Delete condition block"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover/condition:opacity-100"
        >
          <Trash2 size={11} aria-hidden />
        </button>
      </div>

      {collapsed ? null : (
        <>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const chips = chipsByRow.get(row.id) ?? [];
          return (
            <ConditionRow
              key={row.id}
              chips={chips}
              variableIndex={variableIndex}
              variables={variables}
              values={values}
              onAddChip={(input) =>
                startTransition(async () => {
                  await addChip({
                    row_id: row.id,
                    variable_id: input.variable_id,
                    operator: input.operator,
                    text_value_id: input.text_value_id,
                    number_value: input.number_value,
                    aggregate_value: input.aggregate_value,
                  });
                })
              }
              onRemoveChip={(chipId) =>
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("id", chipId);
                  await removeChip(fd);
                })
              }
              onChangeChip={onChangeChip}
              onRemoveRow={() =>
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("id", row.id);
                  await removeRow(fd);
                })
              }
            >
              {renderRowContent(row)}
            </ConditionRow>
          );
        })}
      </div>

      <div className="mt-2 flex justify-center">
        <button
          type="button"
          onClick={handleAddRow}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/40"
        >
          <Plus size={11} aria-hidden /> row
        </button>
      </div>
        </>
      )}
      </div>
      <DropLine active={targetAfter} side="bottom" />
    </div>
  );
}

function ConditionRow({
  chips,
  variableIndex,
  variables,
  values,
  onAddChip,
  onRemoveChip,
  onChangeChip,
  onRemoveRow,
  children,
}: {
  chips: ChipState[];
  variableIndex: Map<string, VariableState>;
  variables: VariableState[];
  values: EndingVariableValue[];
  onAddChip: (input: AddChipInput) => void;
  onRemoveChip: (chipId: string) => void;
  onChangeChip: (chipId: string, patch: Partial<ChipState>) => void;
  onRemoveRow: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(160px,260px)_1fr_auto] gap-2 rounded-md border border-border/60 bg-card/40 p-2">
      <div className="flex flex-wrap items-start gap-1 self-start">
        {chips.length === 0 ? (
          <span className="text-[11px] italic text-muted-foreground">
            (always)
          </span>
        ) : (
          chips.map((chip) => (
            <ChipPill
              key={chip.id}
              chip={chip}
              variable={variableIndex.get(chip.variable_id) ?? null}
              values={values}
              onChange={(patch) => onChangeChip(chip.id, patch)}
              onRemove={() => onRemoveChip(chip.id)}
            />
          ))
        )}
        <AddChipButton
          variables={variables}
          values={values}
          onAdd={onAddChip}
        />
      </div>
      <div className="flex flex-col gap-1">{children}</div>
      <button
        type="button"
        onClick={onRemoveRow}
        aria-label="Delete row"
        title="Delete row"
        className="self-start text-muted-foreground/60 hover:text-destructive"
      >
        <Trash2 size={11} aria-hidden />
      </button>
    </div>
  );
}
