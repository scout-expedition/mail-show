"use client";

import { Fragment, useTransition, type ComponentType } from "react";
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

type BlockKind = "text" | "result" | "condition";

export type TextBlockComponent = ComponentType<{
  block: BlockState;
  onDelete: () => void;
  /** Authoring variable list, fed into the `@[Name]` autocomplete
   *  popup. Same array DocumentEditor passes to BlockList. */
  variables: VariableState[];
}>;

export type ResultBlockComponent = ComponentType<{
  block: BlockState;
  onDelete: () => void;
}>;

/**
 * Leaf components by block_type. Frameworks pass `{ text }`; logic docs
 * pass `{ result: { Component, defaultValue } }`. The result form bundles
 * the default value used when adding a new result block — null disables
 * the "+ result" adder (e.g. framework_selection with no frameworks yet).
 * The list throws if it encounters a leaf type for which no component is
 * supplied — fail loud rather than render nothing.
 */
export interface LeafComponents {
  text?: TextBlockComponent;
  result?: {
    Component: ResultBlockComponent;
    defaultValue: string | null;
  };
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
  disableInsertion,
  rowContext,
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
  /** When true, no insertion zones render — used inside condition rows
   *  that have zero chips, since the row's children won't ever fire. */
  disableInsertion?: boolean;
  /** When true, leading/between insertion zones are skipped once the
   *  row already has at least one block — only the trailing zone
   *  shows. Authoring inside a condition row rarely needs to insert
   *  ahead of an existing block; the simplified UI keeps the row tight. */
  rowContext?: boolean;
}) {
  const drag = useDrag();
  const blocks =
    byParent.get(parentKey(parent.parent_block_id, parent.parent_row_id)) ?? [];
  const [pending, startTransition] = useTransition();

  function handleAdd(kind: BlockKind, beforeBlockId: string | null) {
    if (kind === "text") {
      startTransition(async () => {
        await addBlock({
          document_id,
          parent_block_id: parent.parent_block_id,
          parent_row_id: parent.parent_row_id,
          block_type: "text",
          text: "",
          before_block_id: beforeBlockId,
        });
      });
      return;
    }
    if (kind === "condition") {
      startTransition(async () => {
        await addBlock({
          document_id,
          parent_block_id: parent.parent_block_id,
          parent_row_id: parent.parent_row_id,
          block_type: "condition",
          before_block_id: beforeBlockId,
        });
      });
      return;
    }
    if (kind === "result") {
      const defaultValue = leaves.result?.defaultValue;
      if (defaultValue == null) return;
      startTransition(async () => {
        await addBlock({
          document_id,
          parent_block_id: parent.parent_block_id,
          parent_row_id: parent.parent_row_id,
          block_type: "result",
          result_value: defaultValue,
          before_block_id: beforeBlockId,
        });
      });
    }
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
  const ResultLeaf = leaves.result?.Component;

  // Result-block uniqueness rule: a sibling group either has no result
  // block or has exactly one and nothing else. Drives adder visibility.
  const hasResultBlock = blocks.some((b) => b.block_type === "result");
  const hasAnyOtherBlock = blocks.some((b) => b.block_type !== "result");

  // Build the picker option set once per render based on what's
  // allowed in this sibling group + what leaf components were
  // supplied by the doc surface (frameworks → text; logic → result).
  const addOptions: Array<{ value: BlockKind; label: string; disabled?: boolean }> = [];
  if (TextLeaf) {
    addOptions.push({ value: "text", label: "Text Block" });
  }
  if (ResultLeaf) {
    addOptions.push({
      value: "result",
      label: "Result Block",
      // Result-uniqueness: only addable when the group is empty.
      disabled: hasAnyOtherBlock || leaves.result?.defaultValue == null,
    });
  }
  addOptions.push({ value: "condition", label: "Condition Block" });

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
        "flex flex-col [&>*+*]:-mt-px",
        blocks.length === 0 && isEmptyTarget && "rounded-md ring-2 ring-blue-400"
      )}
    >
      {blocks.length === 0 ? (
        drag.dragId ? (
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
        ) : disableInsertion ? null : (
          <InsertionZone
            options={addOptions}
            onAdd={(kind) => handleAdd(kind, null)}
            disabled={pending}
            alwaysVisible
          />
        )
      ) : null}
      {blocks.map((b, i) => {
        const blockNode =
          b.block_type === "text" ? (
            TextLeaf ? (
              <TextLeaf
                block={b}
                onDelete={() => handleDeleteBlock(b.id)}
                variables={variables}
              />
            ) : (
              (() => {
                throw new Error(
                  "BlockList: encountered text block but no text leaf component supplied."
                );
              })()
            )
          ) : b.block_type === "result" ? (
            ResultLeaf ? (
              <ResultLeaf
                block={b}
                onDelete={() => handleDeleteBlock(b.id)}
              />
            ) : (
              (() => {
                throw new Error(
                  "BlockList: encountered result block but no result leaf component supplied."
                );
              })()
            )
          ) : (
            <ConditionBlock
              block={b}
              rows={rowsByConditionBlock.get(b.id) ?? []}
              chipsByRow={chipsByRow}
              declaredVariables={declaredByBlock.get(b.id) ?? []}
              variableIndex={variableIndex}
              variables={variables}
              values={values}
              onDeleteBlock={() => handleDeleteBlock(b.id)}
              onChangeChip={onChangeChip}
              getRowBlockCount={(rowId) =>
                (byParent.get(parentKey(b.id, rowId)) ?? []).length
              }
              renderRowContent={(row) => {
                const rowChipCount = (chipsByRow.get(row.id) ?? []).length;
                return (
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
                    disableInsertion={rowChipCount === 0}
                    rowContext
                  />
                );
              }}
            />
          );
        return (
          <Fragment key={b.id}>
            {/* Insertion zone before each block — suppressed inside
                a result-only group (nothing legal to insert), inside
                chip-empty rows (children won't ever fire), and inside
                row context once at least one block is already
                present (only the trailing zone remains useful). */}
            {!hasResultBlock && !disableInsertion && !rowContext ? (
              <InsertionZone
                options={addOptions}
                onAdd={(kind) => handleAdd(kind, b.id)}
                disabled={pending}
              />
            ) : null}
            {blockNode}
          </Fragment>
        );
      })}

      {hasResultBlock || disableInsertion ? null : blocks.length > 0 ? (
        <InsertionZone
          options={addOptions}
          onAdd={(kind) => handleAdd(kind, null)}
          disabled={pending}
        />
      ) : null}
    </div>
  );
}

/**
 * Hover-revealed insertion target. The zone itself is a 16px-tall
 * region (so it provides the spacing between blocks); on hover or
 * focus-within, a single dashed-border `+` button appears, which
 * opens a native-select dropdown of allowed block kinds. Clicking an
 * option fires `onAdd(kind)`.
 *
 * `alwaysVisible` is used in the empty-state slot so the user has a
 * persistent target rather than having to discover the hover zone.
 */
function InsertionZone({
  options,
  onAdd,
  disabled,
  alwaysVisible,
}: {
  options: Array<{ value: BlockKind; label: string; disabled?: boolean }>;
  onAdd: (kind: BlockKind) => void;
  disabled?: boolean;
  alwaysVisible?: boolean;
}) {
  const usable = options.filter((o) => !o.disabled);
  if (usable.length === 0) return null;
  return (
    <div className="group/zone relative flex h-10 items-center justify-center">
      <span
        className={cn(
          "group/insertbtn relative inline-flex h-5 items-center transition-opacity",
          alwaysVisible
            ? "opacity-100"
            : "opacity-0 group-hover/zone:opacity-100 focus-within:opacity-100"
        )}
      >
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          disabled={disabled}
          className={cn(
            "inline-flex h-5 w-10 items-center justify-center rounded-md border border-[var(--block-border)] text-muted-foreground transition-colors duration-300 ease-out group-hover/insertbtn:border-solid group-hover/insertbtn:bg-white/10 group-hover/insertbtn:text-foreground disabled:opacity-50",
            alwaysVisible ? "border-solid" : "border-dashed"
          )}
        >
          <Plus size={12} aria-hidden />
        </button>
        <select
          aria-label="Add block"
          disabled={disabled}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          value=""
          onChange={(e) => {
            const v = e.target.value as BlockKind | "";
            e.target.value = "";
            if (v) onAdd(v);
          }}
        >
          <option value="" disabled>
            Add block…
          </option>
          {usable.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
