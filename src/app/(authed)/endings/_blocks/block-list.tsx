"use client";

import { useTransition, type ComponentType } from "react";
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
import { addBlock, deleteBlock } from "../_shared/document-actions";
import { useDrag } from "../_shared/lib/drag";
import { ConditionBlock } from "./condition-block";

export type TextBlockComponent = ComponentType<{
  block: BlockState;
  onChange: (text: string) => void;
  onDelete: () => void;
}>;

export type ResultBlockComponent = ComponentType<{
  block: BlockState;
  onChange: (result_value: string) => void;
  onDelete: () => void;
}>;

/**
 * Leaf components by block_type. Frameworks pass `{ text }`; logic docs
 * pass `{ result }`. The list throws if it encounters a leaf type for
 * which no component is supplied — fail loud rather than render nothing.
 */
export interface LeafComponents {
  text?: TextBlockComponent;
  result?: ResultBlockComponent;
}

/**
 * Recursive list of blocks under a given parent location. Handles drag
 * targets at the head of an empty list, and dispatches text/condition/
 * result blocks. The condition block recursively renders its rows'
 * children via this same component (one level down).
 *
 * Frameworks pass `leaves={{ text: TextBlock }}` and the "+ text" / "+
 * condition" toolbar shows. Logic docs pass `leaves={{ result:
 * ResultBlock }}` and the toolbar shows "+ result" / "+ condition"
 * instead.
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
  document_id,
  leaves,
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
  document_id: string;
  leaves: LeafComponents;
  onUpdateBlock: (id: string, patch: Partial<BlockState>) => void;
  onChangeChip: (chipId: string, patch: Partial<ChipState>) => void;
}) {
  const drag = useDrag();
  const blocks =
    byParent.get(parentKey(parent.parent_block_id, parent.parent_row_id)) ?? [];
  const [pending, startTransition] = useTransition();

  async function handleAddText() {
    startTransition(async () => {
      await addBlock({
        document_id,
        parent_block_id: parent.parent_block_id,
        parent_row_id: parent.parent_row_id,
        block_type: "text",
        text: "",
      });
    });
  }
  async function handleAddCondition() {
    startTransition(async () => {
      await addBlock({
        document_id,
        parent_block_id: parent.parent_block_id,
        parent_row_id: parent.parent_row_id,
        block_type: "condition",
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

  const TextLeaf = leaves.text;
  const ResultLeaf = leaves.result;

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
          if (!TextLeaf) {
            throw new Error(
              "BlockList: encountered text block but no text leaf component supplied."
            );
          }
          return (
            <TextLeaf
              key={b.id}
              block={b}
              onChange={(text) => onUpdateBlock(b.id, { text })}
              onDelete={() => handleDeleteBlock(b.id)}
            />
          );
        }
        if (b.block_type === "result") {
          if (!ResultLeaf) {
            throw new Error(
              "BlockList: encountered result block but no result leaf component supplied."
            );
          }
          return (
            <ResultLeaf
              key={b.id}
              block={b}
              onChange={(result_value) =>
                onUpdateBlock(b.id, { result_value })
              }
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
                document_id={document_id}
                leaves={leaves}
                onUpdateBlock={onUpdateBlock}
                onChangeChip={onChangeChip}
              />
            )}
          />
        );
      })}

      <div className="flex justify-center gap-2">
        {TextLeaf ? (
          <button
            type="button"
            onClick={handleAddText}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/40 disabled:opacity-50"
          >
            <Plus size={11} aria-hidden /> text
          </button>
        ) : null}
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
