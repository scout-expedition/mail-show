"use client";

import { useRef, useTransition } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BlockState,
  ChipState,
  RowState,
  VariableState,
} from "@/lib/endings/block-state";
import type { EndingVariableValue } from "@/lib/db/types";
import { addChip, addRow, removeChip, removeRow } from "../actions";
import { useDrag } from "../lib/drag";
import { AddChipButton, ChipPill, type AddChipInput } from "./chip";

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
  const drag = useDrag();
  const isDragging = drag.dragId === block.id;
  const [pending, startTransition] = useTransition();

  function handleAddRow() {
    startTransition(async () => {
      await addRow({ condition_block_id: block.id });
    });
  }

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
        "group/condition relative rounded-md border border-border bg-muted/20 p-2",
        isDragging && "opacity-40"
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <span
            aria-hidden
            className="cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover/condition:opacity-100"
          >
            <GripVertical size={12} />
          </span>
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
