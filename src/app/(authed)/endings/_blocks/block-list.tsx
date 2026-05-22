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
import type { EndingVariableFolder, EndingVariableValue } from "@/lib/db/types";
import { addBlock, deleteBlock } from "../_shared/document-actions";
import { useDrag } from "../_shared/lib/drag";
import { useCollapseCtx } from "../_shared/lib/total-collapse";
import { ConditionBlock } from "./condition-block";

type BlockKind = "text" | "result" | "condition";

export type TextBlockComponent = ComponentType<{
  block: BlockState;
  onDelete: () => void;
  /** Authoring variable list, fed into the `@[Name]` autocomplete
   *  popup. Same array DocumentEditor passes to BlockList. */
  variables: VariableState[];
  /** Folder rows for the variable picker's nested navigation. */
  folders: EndingVariableFolder[];
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
  smartVariableReturns,
  folders,
  document_id,
  leaves,
  onUpdateBlock,
  onChangeChip,
  disableInsertion,
  rowContext,
  addOptimisticBlock,
  addOptimisticRow,
  addOptimisticChip,
  addOptimisticBlockVariable,
  removeOptimisticBlock,
  removeOptimisticRow,
  removeOptimisticChip,
  removeOptimisticBlockVariable,
  clearOptimisticBlockDelete,
  clearOptimisticRowDelete,
  clearOptimisticChipDelete,
  clearOptimisticBlockVariableDelete,
}: {
  parent: ParentLoc;
  byParent: Map<string, BlockState[]>;
  rowsByConditionBlock: Map<string, RowState[]>;
  chipsByRow: Map<string, ChipState[]>;
  declaredByBlock: Map<string, BlockVariableState[]>;
  variableIndex: Map<string, VariableState>;
  variables: VariableState[];
  values: EndingVariableValue[];
  /** Unique result strings per smart_variable doc, keyed by the paired
   *  smart_ref variable's id. Powers the chip value dropdown for
   *  smart_ref chips. Optional — falls back to empty when absent. */
  smartVariableReturns?: Map<string, string[]>;
  folders: EndingVariableFolder[];
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
  /** Optimistic adders from DocumentEditor's useOptimistic reducers. */
  addOptimisticBlock?: (ghost: BlockState) => void;
  addOptimisticRow?: (ghost: RowState) => void;
  addOptimisticChip?: (ghost: ChipState) => void;
  addOptimisticBlockVariable?: (ghost: BlockVariableState) => void;
  /** Optimistic removers — mark a record with __optimistic_delete so
   *  the render path greys it while the delete server action runs. */
  removeOptimisticBlock?: (id: string) => void;
  removeOptimisticRow?: (id: string) => void;
  removeOptimisticChip?: (id: string) => void;
  removeOptimisticBlockVariable?: (id: string) => void;
  /** Rollback companions — clear the pending-delete flag when the
   *  server action errors so the row doesn't stay grey/disabled
   *  forever waiting for a realtime DELETE that will never arrive. */
  clearOptimisticBlockDelete?: (id: string) => void;
  clearOptimisticRowDelete?: (id: string) => void;
  clearOptimisticChipDelete?: (id: string) => void;
  clearOptimisticBlockVariableDelete?: (id: string) => void;
}) {
  const drag = useDrag();
  const collapse = useCollapseCtx();
  const blocks =
    byParent.get(parentKey(parent.parent_block_id, parent.parent_row_id)) ?? [];
  const [pending, startTransition] = useTransition();
  // "groups" mode renders condition rows as a compact, read-only view —
  // suppress the block-insertion zones inside them.
  const insertionDisabled =
    disableInsertion || (rowContext === true && collapse.mode === "groups");

  function handleAdd(kind: BlockKind, beforeBlockId: string | null) {
    if (kind === "text") {
      startTransition(async () => {
        if (addOptimisticBlock) {
          const siblings =
            byParent.get(
              `${parent.parent_block_id ?? "root"}:${parent.parent_row_id ?? "root"}`
            ) ?? [];
          const maxOrder = siblings.reduce(
            (m, b) => Math.max(m, b.sort_order),
            -1
          );
          addOptimisticBlock({
            id: `tmp-${crypto.randomUUID()}`,
            document_id,
            parent_block_id: parent.parent_block_id,
            parent_row_id: parent.parent_row_id,
            block_type: "text",
            text: "",
            result_value: null,
            summary: "",
            sort_order: maxOrder + 1,
            __optimistic: true,
          });
        }
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
        if (addOptimisticBlock) {
          const siblings =
            byParent.get(
              `${parent.parent_block_id ?? "root"}:${parent.parent_row_id ?? "root"}`
            ) ?? [];
          const maxOrder = siblings.reduce(
            (m, b) => Math.max(m, b.sort_order),
            -1
          );
          addOptimisticBlock({
            id: `tmp-${crypto.randomUUID()}`,
            document_id,
            parent_block_id: parent.parent_block_id,
            parent_row_id: parent.parent_row_id,
            block_type: "condition",
            text: "",
            result_value: null,
            summary: "",
            sort_order: maxOrder + 1,
            __optimistic: true,
          });
        }
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
        if (addOptimisticBlock) {
          const siblings =
            byParent.get(
              `${parent.parent_block_id ?? "root"}:${parent.parent_row_id ?? "root"}`
            ) ?? [];
          const maxOrder = siblings.reduce(
            (m, b) => Math.max(m, b.sort_order),
            -1
          );
          addOptimisticBlock({
            id: `tmp-${crypto.randomUUID()}`,
            document_id,
            parent_block_id: parent.parent_block_id,
            parent_row_id: parent.parent_row_id,
            block_type: "result",
            text: "",
            result_value: defaultValue,
            summary: "",
            sort_order: maxOrder + 1,
            __optimistic: true,
          });
        }
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

  function handleDeleteBlock(id: string) {
    startTransition(async () => {
      // Mark the block as pending-delete so the render path greys it
      // out and ignores interactions until revalidatePath drops it.
      removeOptimisticBlock?.(id);
      const fd = new FormData();
      fd.set("id", id);
      try {
        await deleteBlock(fd);
      } catch (err) {
        // Server rejected the delete — roll the ghost back so the block
        // isn't stuck greyed forever.
        clearOptimisticBlockDelete?.(id);
        throw err;
      }
    });
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
        ) : insertionDisabled ? null : (
          <InsertionZone
            options={addOptions}
            onAdd={(kind) => handleAdd(kind, null)}
            disabled={pending}
            alwaysVisible
          />
        )
      ) : null}
      {blocks.map((b) => {
        // Ghost optimistic block — render a minimal placeholder.
        if (b.__optimistic) {
          const ghostLabel =
            b.block_type === "text"
              ? "Adding text block…"
              : b.block_type === "result"
                ? "Adding result block…"
                : "Adding condition block…";
          return (
            <Fragment key={b.id}>
              {!hasResultBlock && !insertionDisabled && !rowContext ? (
                <InsertionZone
                  options={addOptions}
                  onAdd={(kind) => handleAdd(kind, b.id)}
                  disabled={pending}
                />
              ) : null}
              <div className="opacity-60 italic pointer-events-none rounded-md border border-[var(--block-border)] bg-[var(--block-card)] px-3 py-2 text-sm text-muted-foreground">
                {ghostLabel}
              </div>
            </Fragment>
          );
        }
        const blockNode =
          b.block_type === "text" ? (
            TextLeaf ? (
              <TextLeaf
                block={b}
                onDelete={() => handleDeleteBlock(b.id)}
                variables={variables}
                folders={folders}
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
              smartVariableReturns={smartVariableReturns}
              folders={folders}
              onDeleteBlock={() => handleDeleteBlock(b.id)}
              onChangeChip={onChangeChip}
              getRowBlockCount={(rowId) =>
                (byParent.get(parentKey(b.id, rowId)) ?? []).length
              }
              addOptimisticRow={addOptimisticRow}
              addOptimisticChip={addOptimisticChip}
              addOptimisticBlockVariable={addOptimisticBlockVariable}
              removeOptimisticRow={removeOptimisticRow}
              removeOptimisticChip={removeOptimisticChip}
              removeOptimisticBlockVariable={removeOptimisticBlockVariable}
              clearOptimisticRowDelete={clearOptimisticRowDelete}
              clearOptimisticChipDelete={clearOptimisticChipDelete}
              clearOptimisticBlockVariableDelete={
                clearOptimisticBlockVariableDelete
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
                    smartVariableReturns={smartVariableReturns}
                    folders={folders}
                    document_id={document_id}
                    leaves={leaves}
                    onUpdateBlock={onUpdateBlock}
                    onChangeChip={onChangeChip}
                    addOptimisticBlock={addOptimisticBlock}
                    addOptimisticRow={addOptimisticRow}
                    addOptimisticChip={addOptimisticChip}
                    addOptimisticBlockVariable={addOptimisticBlockVariable}
                    removeOptimisticBlock={removeOptimisticBlock}
                    removeOptimisticRow={removeOptimisticRow}
                    removeOptimisticChip={removeOptimisticChip}
                    removeOptimisticBlockVariable={removeOptimisticBlockVariable}
                    clearOptimisticBlockDelete={clearOptimisticBlockDelete}
                    clearOptimisticRowDelete={clearOptimisticRowDelete}
                    clearOptimisticChipDelete={clearOptimisticChipDelete}
                    clearOptimisticBlockVariableDelete={
                      clearOptimisticBlockVariableDelete
                    }
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
            {!hasResultBlock && !insertionDisabled && !rowContext ? (
              <InsertionZone
                options={addOptions}
                onAdd={(kind) => handleAdd(kind, b.id)}
                disabled={pending}
              />
            ) : null}
            {b.__optimistic_delete ? (
              <div className="opacity-60 italic pointer-events-none">
                {blockNode}
              </div>
            ) : (
              blockNode
            )}
          </Fragment>
        );
      })}

      {hasResultBlock || insertionDisabled ? null : blocks.length > 0 ? (
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
