"use client";

import { useTransition } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BlockState,
  BlockVariableState,
  ChipState,
  ParentLoc,
  RowState,
  VariableState,
} from "@/lib/endings/block-state";
import { parentKey } from "@/lib/endings/block-state";
import type { EndingVariableValue } from "@/lib/db/types";
import { createConditionBlock, createTextBlock, deleteBlock } from "../actions";
import { useDrag } from "../lib/drag";
import { ConditionBlock } from "./condition-block";
import { TextBlock } from "./text-block";

/**
 * Recursive list of blocks under a given parent location. Handles drag
 * targets at the head of an empty list, and dispatches text/condition
 * blocks. The condition block recursively renders its rows' children
 * via this same component (one level down).
 */
export function BlockList({
  parent,
  byParent,
  rowsByConditionBlock,
  chipsByRow,
  declaredByBlock,
  variableIndex,
  variables,
  values,
  framework_id,
  onUpdateBlock,
  onChangeChip,
}: {
  parent: ParentLoc;
  byParent: Map<string, BlockState[]>;
  rowsByConditionBlock: Map<string, RowState[]>;
  chipsByRow: Map<string, ChipState[]>;
  declaredByBlock: Map<string, BlockVariableState[]>;
  variableIndex: Map<string, VariableState>;
  variables: VariableState[];
  values: EndingVariableValue[];
  framework_id: string;
  onUpdateBlock: (id: string, patch: Partial<BlockState>) => void;
  onChangeChip: (chipId: string, patch: Partial<ChipState>) => void;
}) {
  const drag = useDrag();
  const blocks = byParent.get(parentKey(parent.parent_block_id, parent.parent_row_id)) ?? [];
  const [pending, startTransition] = useTransition();

  async function handleAddText() {
    startTransition(async () => {
      await createTextBlock({
        framework_id,
        parent_block_id: parent.parent_block_id,
        parent_row_id: parent.parent_row_id,
      });
    });
  }
  async function handleAddCondition() {
    startTransition(async () => {
      await createConditionBlock({
        framework_id,
        parent_block_id: parent.parent_block_id,
        parent_row_id: parent.parent_row_id,
      });
    });
  }

  async function handleDeleteBlock(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteBlock(fd);
  }

  const isEmptyTarget =
    drag.target?.kind === "empty" &&
    drag.target.parent_block_id === parent.parent_block_id &&
    drag.target.parent_row_id === parent.parent_row_id;

  return (
    <div
      onDragEnter={(e) => {
        if (drag.dragId && blocks.length === 0) {
          e.preventDefault();
          e.stopPropagation();
          drag.setTarget({
            kind: "empty",
            parent_block_id: parent.parent_block_id,
            parent_row_id: parent.parent_row_id,
          });
        }
      }}
      onDragOver={(e) => {
        if (drag.dragId && blocks.length === 0) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
          drag.setTarget({
            kind: "empty",
            parent_block_id: parent.parent_block_id,
            parent_row_id: parent.parent_row_id,
          });
        }
      }}
      onDrop={(e) => {
        if (drag.dragId && blocks.length === 0) {
          e.preventDefault();
          e.stopPropagation();
          drag.commit();
        }
      }}
      className={cn(
        "flex flex-col gap-2",
        blocks.length === 0 && isEmptyTarget && "rounded-md ring-2 ring-blue-400"
      )}
    >
      {blocks.length === 0 ? (
        <p
          className={cn(
            "rounded-md border border-dashed px-3 py-2 text-center text-xs",
            isEmptyTarget
              ? "border-blue-400 bg-blue-400/10 text-blue-200"
              : "border-border text-muted-foreground"
          )}
        >
          (no blocks)
        </p>
      ) : null}
      {blocks.map((b) => {
        if (b.block_type === "text") {
          return (
            <TextBlock
              key={b.id}
              block={b}
              onChange={(text) => onUpdateBlock(b.id, { text })}
              onDelete={() => handleDeleteBlock(b.id)}
            />
          );
        }
        return (
          <ConditionBlock
            key={b.id}
            block={b}
            rows={rowsByConditionBlock.get(b.id) ?? []}
            chipsByRow={chipsByRow}
            declaredVariables={declaredByBlock.get(b.id) ?? []}
            variableIndex={variableIndex}
            variables={variables}
            values={values}
            onDeleteBlock={() => handleDeleteBlock(b.id)}
            onChangeChip={onChangeChip}
            renderRowContent={(row) => (
              <BlockList
                parent={{
                  parent_block_id: b.id,
                  parent_row_id: row.id,
                }}
                byParent={byParent}
                rowsByConditionBlock={rowsByConditionBlock}
                chipsByRow={chipsByRow}
                declaredByBlock={declaredByBlock}
                variableIndex={variableIndex}
                variables={variables}
                values={values}
                framework_id={framework_id}
                onUpdateBlock={onUpdateBlock}
                onChangeChip={onChangeChip}
              />
            )}
          />
        );
      })}

      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={handleAddText}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/40 disabled:opacity-50"
        >
          <Plus size={11} aria-hidden /> text
        </button>
        <button
          type="button"
          onClick={handleAddCondition}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/40 disabled:opacity-50"
        >
          <Plus size={11} aria-hidden /> condition
        </button>
      </div>
    </div>
  );
}
