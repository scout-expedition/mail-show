"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { IconArrowsSplit2 } from "@tabler/icons-react";
import { OverflowMenu } from "@/components/panel";
import { useConfirm } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import type {
  BlockState,
  BlockVariableState,
  ChipState,
  RowState,
  VariableState,
} from "@/lib/endings/block-state";
import {
  AGGREGATE_OPTIONS_BY_REF,
  type EndingChipOperator,
} from "@/lib/db/enums";
import { TIE_OUTCOME, UNSET_TEXT_OUTCOME } from "@/lib/endings/static-analysis";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";
import type { EndingVariableFolder, EndingVariableValue } from "@/lib/db/types";
import {
  addBlockVariable,
  addChip,
  addRow,
  deleteChip,
  deleteRow,
  duplicateBlock,
  duplicateRow,
  patchBlock,
  removeBlockVariable,
} from "../_shared/document-actions";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { useDrag, type DragTarget } from "../_shared/lib/drag";
import { useAnalysis } from "../_shared/lib/analysis";
import { useCollapseCtx } from "../_shared/lib/total-collapse";
import {
  ChipPill,
  VariableChip,
  type AddChipInput,
} from "./chip";
import { DropLine } from "./text-block";
import {
  buildPickerItems,
  VariablePickerPanel,
  type PickerItem,
} from "@/components/variable-picker/variable-picker-panel";
import { buildVariableTree } from "@/lib/endings/variable-categories";
import { CreateVariablePopover } from "./create-variable-popover";

export function ConditionBlock({
  block,
  rows,
  chipsByRow,
  declaredVariables,
  variableIndex,
  variables,
  values,
  folders,
  onDeleteBlock,
  onChangeChip,
  renderRowContent,
  getRowBlockCount,
}: {
  block: BlockState;
  rows: RowState[];
  chipsByRow: Map<string, ChipState[]>;
  declaredVariables: BlockVariableState[];
  variableIndex: Map<string, VariableState>;
  variables: VariableState[];
  values: EndingVariableValue[];
  folders: EndingVariableFolder[];
  onDeleteBlock: () => void;
  onChangeChip: (chipId: string, patch: Partial<ChipState>) => void;
  /** Render the recursive child-block list for a given row. */
  renderRowContent: (row: RowState) => React.ReactNode;
  /** Number of blocks under each row's children area. Used to close
   *  off the row's chip pills with a right border when the row has
   *  no child blocks. */
  getRowBlockCount?: (rowId: string) => number;
}) {
  const { peers, setFocus } = usePresenceContext();
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
  const ref = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const drag = useDrag();
  const analysis = useAnalysis();
  const collapseCtx = useCollapseCtx();
  const collapseMode = collapseCtx.mode;
  const isDragging = drag.dragId === block.id;
  const [pending, startTransition] = useTransition();
  const override = collapseCtx.overrides.get(block.id);
  // "groups" mode keeps condition blocks open — only "all" collapses them.
  const panelCollapsed = collapseMode === "all";
  const collapsed = override ?? panelCollapsed;
  // In "groups" mode the block renders as a compact, read-only structural
  // view: tighter row spacing, no dividers, no add affordances.
  const groupsCompact = collapseMode === "groups";
  const handleToggleCollapsed = () => {
    collapseCtx.setOverride(block.id, !collapsed);
  };
  const [uncoveredOpen, setUncoveredOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm({ scoped: false });
  const blockAnalysis = analysis.blockAnalysis.get(block.id);
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
      await addRow({ block_id: block.id });
    });
  }

  const dragFocusKey = {
    table: "ending_blocks",
    recordId: block.id,
    field: "drag",
  } as const;

  return (
    <div ref={ref} className="relative">
      <DropLine active={targetBefore} side="top" />
      <FieldHighlight peers={peers} focusKey={dragFocusKey}>
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
          "group/condition relative h-full min-h-full rounded-md border bg-[var(--block-card)] p-2",
          "border-[var(--block-border)]",
          isDragging && "opacity-40"
        )}
      >
      <div className={cn("group/header flex items-center gap-1 px-0", collapsed ? "pb-0" : "pb-2") }>
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
            aria-label={collapsed ? "Expand condition block" : "Collapse condition block"}
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
          <IconArrowsSplit2
            size={14}
            aria-label={`Condition block with ${rows.length} ${rows.length === 1 ? "row" : "rows"}`}
            className="text-muted-foreground/70"
          />
          <HeaderVariableStrip
            blockId={block.id}
            declaredVariables={declaredVariables}
            variableIndex={variableIndex}
            variables={variables}
            folders={folders}
            confirm={confirm}
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
          {blockAnalysis ? (
            <BlockAnalysisBadge
              analysis={blockAnalysis}
              variables={variables}
              values={values}
              open={uncoveredOpen}
              onToggle={() => setUncoveredOpen((v) => !v)}
            />
          ) : null}
          <div>
            <OverflowMenu
              items={[
                {
                  label: "Duplicate Condition Block",
                  icon: <Copy size={10} aria-hidden />,
                  onClick: () => {
                    startTransition(async () => {
                      await duplicateBlock({ id: block.id });
                    });
                  },
                },
                {
                  label: "Delete Condition Block",
                  intent: "destructive",
                  icon: <Trash2 size={10} aria-hidden />,
                  onClick: async () => {
                    const ok = await confirm({
                      title: "Delete condition block?",
                      message:
                        "This removes the block and every row, chip, and child block inside it. This can't be undone.",
                      confirmLabel: "Delete",
                      intent: "destructive",
                    });
                    if (ok) onDeleteBlock();
                  },
                },
              ]}
            />
          </div>
        </div>
      </div>

      {collapsed ? null : (
        <>
      {blockAnalysis &&
      uncoveredOpen &&
      (blockAnalysis.uncovered.length > 0 ||
        blockAnalysis.numericGaps.length > 0) ? (
        <UncoveredList
          analysis={blockAnalysis}
          variables={variables}
          values={values}
        />
      ) : null}
      <div
        className={cn(
          "flex flex-col rounded-md bg-[var(--block-result-bg)]",
          groupsCompact
            ? "gap-2.5 p-2"
            : "gap-5 divide-y divide-white/10 px-2 py-5 [&>*+*]:pt-5"
        )}
      >
        {rows.map((row) => {
          const chips = chipsByRow.get(row.id) ?? [];
          const coveredById = analysis.shadowByRowId.get(row.id) ?? null;
          const coveredByOrdinal = coveredById
            ? analysis.rowSortOrder.get(coveredById) ?? null
            : null;
          const overlap = analysis.overlapByRowId.get(row.id) ?? null;
          return (
            <ConditionRow
              key={row.id}
              chips={chips}
              declaredVariables={declaredVariables}
              variableIndex={variableIndex}
              variables={variables}
              values={values}
              shadowedByOrdinal={coveredByOrdinal}
              overlap={overlap}
              rowSortOrder={analysis.rowSortOrder}
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
                  await deleteChip(fd);
                })
              }
              onChangeChip={onChangeChip}
              onRemoveRow={() =>
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("id", row.id);
                  await deleteRow(fd);
                })
              }
              onDuplicateRow={() =>
                startTransition(async () => {
                  await duplicateRow({ id: row.id });
                })
              }
              closeChips={(getRowBlockCount?.(row.id) ?? 1) === 0}
              compact={groupsCompact}
            >
              {renderRowContent(row)}
            </ConditionRow>
          );
        })}
        {declaredVariables.length > 0 && !groupsCompact ? (
          <div className="grid grid-cols-[minmax(120px,160px)_1fr_auto] gap-x-0 !pt-0">
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleAddRow}
                disabled={pending}
                aria-label="Add row"
                title="Add row"
                className="inline-flex h-5 w-10 items-center justify-center rounded-md border border-dashed border-[var(--block-border)] text-muted-foreground opacity-40 transition-[opacity,colors,border-style] duration-300 ease-out hover:border-solid hover:bg-white/10 hover:text-foreground hover:opacity-100 disabled:opacity-50"
              >
                <Plus size={12} aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
        </>
      )}
      </div>
      </FieldHighlight>
      <DropLine active={targetAfter} side="bottom" />
      {confirmDialog}
    </div>
  );
}

function ConditionRow({
  chips,
  declaredVariables,
  variableIndex,
  variables,
  values,
  shadowedByOrdinal,
  overlap,
  rowSortOrder,
  onAddChip,
  onRemoveChip,
  onChangeChip,
  onRemoveRow,
  onDuplicateRow,
  closeChips,
  compact,
  children,
}: {
  chips: ChipState[];
  declaredVariables: BlockVariableState[];
  variableIndex: Map<string, VariableState>;
  variables: VariableState[];
  values: EndingVariableValue[];
  shadowedByOrdinal: number | null;
  overlap: import("@/lib/endings/static-analysis").NumericRowOverlap | null;
  rowSortOrder: Map<string, number>;
  onAddChip: (input: AddChipInput) => void;
  onRemoveChip: (chipId: string) => void;
  onChangeChip: (chipId: string, patch: Partial<ChipState>) => void;
  onRemoveRow: () => void;
  onDuplicateRow: () => void;
  closeChips?: boolean;
  /** Groups-mode compact view — hides the in-row chip adder. */
  compact?: boolean;
  children: React.ReactNode;
}) {
  const { confirm: confirmRow, dialog: rowDialog } = useConfirm();
  const fullyOverlapped = overlap?.fullShadow ?? false;
  // Render the row's chips grouped by declared variable order, then any
  // orphan chips (chips on a variable not in the header — shouldn't
  // happen post-Phase-6 but safe-guard), then a single + adder.
  const chipsByVariableId = new Map<string, ChipState[]>();
  for (const c of chips) {
    const list = chipsByVariableId.get(c.variable_id);
    if (list) list.push(c);
    else chipsByVariableId.set(c.variable_id, [c]);
  }
  const declaredIds = new Set(declaredVariables.map((d) => d.variable_id));
  const orphanChips = chips.filter((c) => !declaredIds.has(c.variable_id));
  return (
    <div
      className={cn(
        "group/row relative grid grid-cols-[minmax(120px,160px)_1fr_auto] items-stretch gap-x-0",
        (shadowedByOrdinal != null || fullyOverlapped) &&
          "rounded-md bg-amber-500/5 p-1 ring-1 ring-amber-500/40",
        // Reserve vertical space at the top of the row for the
        // shadow-warning pill so it sits in its own padding strip
        // instead of overlapping the block in the children column.
        shadowedByOrdinal != null && "!pt-8"
      )}
    >
      {shadowedByOrdinal != null ? (
        <span
          title={`This row's chips are fully covered by row ${shadowedByOrdinal}, so first-match-wins means it can never fire.`}
          className="absolute right-9 top-1 z-10 inline-flex h-5 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 text-[10px] font-mono font-semibold uppercase leading-[16px] tracking-[0.025em] text-amber-200"
        >
          <AlertTriangle size={10} aria-hidden className="text-amber-200" />
          <span className="text-[9px] text-amber-200">
            Overlap with Row {shadowedByOrdinal}
          </span>
        </span>
      ) : null}
      <div className="group/chips mt-1 flex flex-col gap-2 pb-2">
        {declaredVariables.length === 0 ? null : (
          declaredVariables.flatMap((dv) => {
            const variable = variableIndex.get(dv.variable_id);
            const slotChips = chipsByVariableId.get(dv.variable_id) ?? [];
            return slotChips.map((chip) => (
              <ChipPill
                key={chip.id}
                chip={chip}
                variable={variable ?? null}
                variables={variables}
                values={values}
                compact
                onChange={(patch) => onChangeChip(chip.id, patch)}
                onRemove={() => onRemoveChip(chip.id)}
                closeRight={closeChips}
              />
            ));
          })
        )}
        {orphanChips.map((chip) => (
          <ChipPill
            key={chip.id}
            chip={chip}
            variable={variableIndex.get(chip.variable_id) ?? null}
            variables={variables}
            values={values}
            onChange={(patch) => onChangeChip(chip.id, patch)}
            onRemove={() => onRemoveChip(chip.id)}
            closeRight={closeChips}
          />
        ))}
        {declaredVariables.length > 0 && !compact ? (
          <RowChipAdder
            declaredVariables={declaredVariables}
            variableIndex={variableIndex}
            values={values}
            onAdd={onAddChip}
            alwaysVisible={chips.length === 0}
          />
        ) : null}
        {overlap ? (
          <OverlapBadge
            overlap={overlap}
            variableIndex={variableIndex}
            rowSortOrder={rowSortOrder}
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-1 [&>*]:flex-1 [&>*]:min-h-0">{children}</div>
      <div
        data-row-kebab
        className="ml-0.5 self-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100"
      >
        <OverflowMenu
          items={[
            {
              label: "Duplicate Row",
              icon: <Copy size={10} aria-hidden />,
              onClick: () => onDuplicateRow(),
            },
            {
              label: "Delete Row",
              intent: "destructive",
              icon: <Trash2 size={10} aria-hidden />,
              onClick: async () => {
                const ok = await confirmRow({
                  title: "Delete row?",
                  message:
                    "This removes the row, every chip on it, and every block under it. This can't be undone.",
                  confirmLabel: "Delete",
                  intent: "destructive",
                });
                if (ok) onRemoveRow();
              },
            },
          ]}
        />
      </div>
      {rowDialog}
    </div>
  );
}

// ---------------------------------------------------------------------
// Static-analysis badge + expansion panel
// ---------------------------------------------------------------------

function BlockAnalysisBadge({
  analysis,
  variables,
  values,
  open,
  onToggle,
}: {
  analysis: import("@/lib/endings/static-analysis").BlockAnalysis;
  variables: VariableState[];
  values: EndingVariableValue[];
  open: boolean;
  onToggle: () => void;
}) {
  void variables;
  void values;
  if (analysis.status === "no_finite_vars") {
    if (analysis.partial) {
      return (
        <span
          title="This block's rows reference multiple numeric variables. Multi-axis numeric analysis isn't run; coverage isn't statically determinable."
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
        >
          partial coverage
        </span>
      );
    }
    return null;
  }
  if (analysis.status === "cap_exceeded") {
    return (
      <span
        title="Too many variable combinations to enumerate uncovered assignments."
        className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
      >
        too many combos
      </span>
    );
  }
  if (analysis.status === "covered") {
    if (analysis.partial) {
      return (
        <span
          title="No finite-domain gaps detected, but this block contains numeric chips that aren't statically analyzed."
          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
        >
          partial coverage
        </span>
      );
    }
    return null;
  }
  // has_uncovered
  const count = analysis.uncovered.length + analysis.numericGaps.length;
  const partialSuffix = analysis.partial ? "+" : "";
  const partialTitle = analysis.partial
    ? " (numeric chips not analyzed; more combos may be uncovered at runtime)"
    : "";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        (open ? "Hide uncovered list" : "Show uncovered list") + partialTitle
      }
      className="inline-flex h-5 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 text-[10px] font-mono font-semibold uppercase leading-[16px] tracking-[0.025em] text-amber-200 hover:bg-amber-500/10"
    >
      <AlertTriangle size={10} aria-hidden className="text-amber-200" />
      <span className="text-[9px] text-amber-200">
        {count}
        {partialSuffix}
      </span>
    </button>
  );
}

function UncoveredList({
  analysis,
  variables,
  values,
}: {
  analysis: import("@/lib/endings/static-analysis").BlockAnalysis;
  variables: VariableState[];
  values: EndingVariableValue[];
}) {
  const variableById = new Map(variables.map((v) => [v.id, v]));
  const valueById = new Map(values.map((v) => [v.id, v]));
  return (
    <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-[11px]">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-amber-200/80">
        Uncovered assignments
      </div>
      <ul className="flex flex-col gap-0.5 text-amber-100/80">
        {analysis.numericGaps.map((g, i) => (
          <li key={`n-${i}`} className="font-mono">
            · {formatNumericGap(g, variableById)}
          </li>
        ))}
        {analysis.uncovered.map((a, i) => (
          <li key={`f-${i}`} className="font-mono">
            · {formatAssignment(a, variableById, valueById)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Single + adder per row. Closed state is one button. Click:
 *   - 1 declared variable → opens the picker form pinned to that var.
 *   - 2+ declared variables → opens an inline chooser; pick one → picker.
 */
function RowChipAdder({
  declaredVariables,
  variableIndex,
  values,
  onAdd,
  alwaysVisible,
}: {
  declaredVariables: BlockVariableState[];
  variableIndex: Map<string, VariableState>;
  values: EndingVariableValue[];
  onAdd: (input: AddChipInput) => void;
  /** When true, the + button is always visible (no hover required).
   *  Used when the row has zero chips so the affordance is obvious. */
  alwaysVisible?: boolean;
}) {
  const declaredVarStates = declaredVariables
    .map((d) => variableIndex.get(d.variable_id))
    .filter((v): v is VariableState => Boolean(v));
  if (declaredVarStates.length === 0) return null;

  // Add a chip directly — no intermediate fill form. Operator picks
  // the kind/aref-appropriate default; values seed from the variable's
  // default (or first available) so the server's value-shape CHECK
  // passes on first save.
  function addDefault(variable: VariableState) {
    const operator: EndingChipOperator =
      variable.kind === "aggregate_ref"
        ? variable.aggregate_ref === "nation_tiebreak_set"
          ? "set_includes"
          : "top="
        : "=";
    const aggregateValue =
      variable.kind === "aggregate_ref" && variable.aggregate_ref
        ? AGGREGATE_OPTIONS_BY_REF[variable.aggregate_ref]?.[0] ?? null
        : null;
    let textValueId: string | null = null;
    if (variable.kind === "text") {
      const fallback =
        variable.default_value_id ??
        values.find((v) => v.variable_id === variable.id)?.id ??
        null;
      if (!fallback) {
        // No values on this variable yet — bail out gracefully. The
        // user needs to create a value via the variables page (or via
        // "+ New value…" once a chip exists) first.
        return;
      }
      textValueId = fallback;
    }
    onAdd({
      variable_id: variable.id,
      operator,
      text_value_id: textValueId,
      number_value: variable.kind === "number_ref" ? 0 : null,
      aggregate_value: aggregateValue,
    });
  }

  if (declaredVarStates.length === 1) {
    const v = declaredVarStates[0];
    return (
      <button
        type="button"
        onClick={() => addDefault(v)}
        aria-label={`Add ${v.name} chip`}
        className={cn(
          "inline-flex h-5 w-10 items-center justify-center self-center rounded-md border border-[var(--block-border)] text-muted-foreground transition-[opacity,colors,border-style] duration-300 ease-out hover:border-solid hover:bg-white/10 hover:text-foreground focus-visible:opacity-100",
          alwaysVisible
            ? "opacity-100 border-solid"
            : "opacity-0 border-dashed group-hover/chips:opacity-100"
        )}
      >
        <Plus size={12} aria-hidden />
      </button>
    );
  }

  // 2+ declared variables — invisible <select> overlay on the +
  // button so clicking it opens the native dropdown. Picking a var
  // immediately seeds a default chip on that variable.
  return (
    <span className={cn(
      "group/chipbtn relative inline-flex h-5 items-center self-center transition-opacity focus-within:opacity-100",
      alwaysVisible
        ? "opacity-100"
        : "opacity-0 group-hover/chips:opacity-100"
    )}>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className={cn(
          "inline-flex h-5 w-10 items-center justify-center rounded-md border border-[var(--block-border)] text-muted-foreground transition-colors duration-300 ease-out group-hover/chipbtn:border-solid group-hover/chipbtn:bg-white/10 group-hover/chipbtn:text-foreground",
          alwaysVisible ? "border-solid" : "border-dashed"
        )}
      >
        <Plus size={12} aria-hidden />
      </button>
      <select
        aria-label="Add chip — pick a variable"
        defaultValue=""
        onChange={(e) => {
          const v = declaredVarStates.find((dv) => dv.id === e.target.value);
          if (v) addDefault(v);
          e.currentTarget.value = "";
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="" disabled>
          variable…
        </option>
        {declaredVarStates.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * Header variable strip — renders the variables a condition block branches
 * on (Phase 6 header-declared model). Add via the "+ var" pill, remove
 * via the × on each variable chip.
 */
function HeaderVariableStrip({
  blockId,
  declaredVariables,
  variableIndex,
  variables,
  folders,
  confirm,
}: {
  blockId: string;
  declaredVariables: BlockVariableState[];
  variableIndex: Map<string, VariableState>;
  variables: VariableState[];
  folders: EndingVariableFolder[];
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const [pending, startTransition] = useTransition();
  // Optimistic shadow of just-added variables — keeps the chip on screen
  // while the addBlockVariable server action runs and revalidatePath
  // ripples back. Pruned automatically once the prop's
  // declaredVariables catches up.
  const [optimisticVarIds, setOptimisticVarIds] = useState<string[]>([]);
  const declaredIds = new Set(declaredVariables.map((d) => d.variable_id));
  useEffect(() => {
    setOptimisticVarIds((prev) =>
      prev.filter((id) => !declaredIds.has(id))
    );
    // declaredIds is derived from declaredVariables on every render; depend
    // on declaredVariables (stable identity from the parent reducer)
    // rather than recomputing the Set in the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declaredVariables]);
  const eligible = variables.filter(
    (v) => !declaredIds.has(v.id) && !optimisticVarIds.includes(v.id)
  );

  return (
    <span className="ml-1 inline-flex flex-wrap items-center gap-2">
      {declaredVariables.map((dv) => {
        const v = variableIndex.get(dv.variable_id);
        if (!v) return null;
        return (
          <VariableChip
            key={dv.id}
            variable={v}
            disabled={pending}
            onRemove={async () => {
              const ok = await confirm({
                title: `Remove ${v.name} from this condition block?`,
                message:
                  "This also removes every chip on the block's rows that referenced this variable.",
                confirmLabel: "Remove",
                intent: "destructive",
              });
              if (!ok) return;
              startTransition(async () => {
                const fd = new FormData();
                fd.set("id", dv.id);
                await removeBlockVariable(fd);
              });
            }}
          />
        );
      })}
      {optimisticVarIds.map((vid) => {
        const v = variableIndex.get(vid);
        if (!v) return null;
        return <VariableChip key={`optimistic-${vid}`} variable={v} disabled />;
      })}
      {eligible.length > 0 ? (
        <AddHeaderVariablePicker
          variables={eligible}
          folders={folders}
          disabled={pending}
          alwaysVisible={
            declaredVariables.length === 0 && optimisticVarIds.length === 0
          }
          onPick={(variable_id) => {
            setOptimisticVarIds((prev) =>
              prev.includes(variable_id) ? prev : [...prev, variable_id]
            );
            startTransition(async () => {
              try {
                await addBlockVariable({
                  block_id: blockId,
                  variable_id,
                });
              } catch (err) {
                // Roll back the optimistic chip if the server rejected it.
                setOptimisticVarIds((prev) =>
                  prev.filter((id) => id !== variable_id)
                );
                throw err;
              }
            });
          }}
        />
      ) : null}
    </span>
  );
}

type PickerMode = "closed" | "picker" | "create";

function AddHeaderVariablePicker({
  variables,
  folders,
  disabled,
  onPick,
  alwaysVisible,
}: {
  variables: VariableState[];
  folders: EndingVariableFolder[];
  disabled: boolean;
  onPick: (variable_id: string) => void;
  /** When true, the + button is always visible. Used in the empty
   *  condition-block state so authors immediately see the affordance. */
  alwaysVisible?: boolean;
}) {
  const [mode, setMode] = useState<PickerMode>("closed");
  const [anchorPos, setAnchorPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  // Picker panel state
  const [query, setQuery] = useState("");
  const [path, setPath] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const btnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Build the variable tree (memoized — stable variable objects from props)
  const tree = useMemo(
    () => buildVariableTree(variables, folders),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variables, folders]
  );

  const items: PickerItem[] = useMemo(
    () => buildPickerItems(tree, path, query),
    [tree, path, query]
  );

  // Reset activeIndex when items list changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [items.length, query]);

  // Click-outside + Esc close for the picker popover
  useEffect(() => {
    if (mode !== "picker") return;
    function onMouseDown(e: MouseEvent) {
      const picker = pickerRef.current;
      const btn = btnRef.current;
      if (!picker) return;
      if (e.target instanceof Node && picker.contains(e.target)) return;
      if (e.target instanceof Node && btn && btn.contains(e.target)) return;
      setMode("closed");
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMode("closed");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [mode]);

  function openPicker() {
    if (disabled) return;
    const btn = btnRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setAnchorPos({ top: rect.bottom + 4, left: rect.left });
    }
    setQuery("");
    setPath([]);
    setActiveIndex(0);
    setMode("picker");
  }

  function commitItem(item: PickerItem) {
    if (item.kind === "variable") {
      onPick(item.variable.id);
      setMode("closed");
    } else if (item.kind === "category" || item.kind === "folder") {
      setPath((prev) => [...prev, item.id]);
      setQuery("");
      setActiveIndex(0);
    } else if (item.kind === "back") {
      setPath((prev) => prev.slice(0, -1));
      setActiveIndex(0);
    } else if (item.kind === "create") {
      // Switch to create mode at the same anchor
      setMode("create");
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length > 0 ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        items.length > 0 ? (i - 1 + items.length) % items.length : 0
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) commitItem(item);
    } else if (e.key === "Backspace" && query === "" && path.length > 0) {
      setPath((prev) => prev.slice(0, -1));
      setActiveIndex(0);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMode("closed");
    }
  }

  return (
    <>
      <span
        className={cn(
          "group/varbtn relative inline-flex h-5 items-center transition-opacity focus-within:opacity-100",
          alwaysVisible
            ? "opacity-100"
            : "opacity-0 group-hover/header:opacity-100"
        )}
      >
        <button
          ref={btnRef}
          type="button"
          aria-label="Add variable to this condition block"
          aria-expanded={mode === "picker"}
          disabled={disabled}
          onClick={openPicker}
          className={cn(
            "inline-flex h-5 w-10 items-center justify-center rounded-md border border-[var(--block-border)] text-muted-foreground transition-colors duration-300 ease-out group-hover/varbtn:border-solid group-hover/varbtn:bg-white/10 group-hover/varbtn:text-foreground disabled:opacity-50",
            alwaysVisible ? "border-solid" : "border-dashed"
          )}
        >
          <Plus size={12} aria-hidden />
        </button>
      </span>

      {mode === "picker" ? (
        <div
          ref={pickerRef}
          style={{
            position: "fixed",
            top: anchorPos.top,
            left: anchorPos.left,
            zIndex: 30,
          }}
          className="w-56"
        >
          <div className="flex flex-col rounded-md border border-border bg-popover shadow-lg">
            <div className="border-b border-border/60 px-2 py-1">
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => {
                  const next = e.target.value;
                  // Clear path when transitioning from empty to non-empty
                  if (query === "" && next !== "") setPath([]);
                  setQuery(next);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="Search variables…"
                aria-label="Search variables"
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
              />
            </div>
            <VariablePickerPanel
              items={items}
              activeIndex={activeIndex}
              onChangeActiveIndex={setActiveIndex}
              onCommitItem={commitItem}
              ariaLabel="Variable picker"
              className="border-0 shadow-none rounded-none rounded-b-md"
            />
          </div>
        </div>
      ) : null}

      {mode === "create" ? (
        <CreateVariablePopover
          position={anchorPos}
          folders={folders}
          onClose={() => setMode("closed")}
          onCreated={({ variableId }) => {
            setMode("closed");
            onPick(variableId);
          }}
        />
      ) : null}
    </>
  );
}

function OverlapBadge({
  overlap,
  variableIndex,
  rowSortOrder,
}: {
  overlap: import("@/lib/endings/static-analysis").NumericRowOverlap;
  variableIndex: Map<string, VariableState>;
  rowSortOrder: Map<string, number>;
}) {
  const ordinals = overlap.earlier_row_ids
    .map((id) => rowSortOrder.get(id))
    .filter((n): n is number => n != null);
  const rowList =
    ordinals.length === 1
      ? `row ${ordinals[0]}`
      : ordinals.length === 2
      ? `rows ${ordinals[0]} & ${ordinals[1]}`
      : `rows ${ordinals.slice(0, -1).join(", ")} & ${ordinals[ordinals.length - 1]}`;
  const ranges = overlap.intervals
    .map((iv) => formatNumericGap(iv, variableIndex))
    .join(", ");
  const verb = overlap.fullShadow ? "shadowed by" : "overlaps";
  return (
    <span
      title={`${verb} ${rowList} at ${ranges}`}
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-amber-200"
    >
      <AlertTriangle size={10} aria-hidden />
      {verb} {rowList} at {ranges}
    </span>
  );
}

function formatNumericGap(
  gap: import("@/lib/endings/static-analysis").NumericGap,
  variableById: Map<string, VariableState>
): string {
  const name = variableById.get(gap.variable_id)?.name ?? gap.variable_id;
  const lo = gap.low === -Infinity ? null : gap.low;
  const hi = gap.high === Infinity ? null : gap.high;
  if (lo == null && hi == null) return name;
  if (lo == null) {
    return `${name} ${gap.highInclusive ? "≤" : "<"} ${hi}`;
  }
  if (hi == null) {
    return `${name} ${gap.lowInclusive ? "≥" : ">"} ${lo}`;
  }
  if (lo === hi && gap.lowInclusive && gap.highInclusive) {
    return `${name} = ${lo}`;
  }
  return `${lo} ${gap.lowInclusive ? "≤" : "<"} ${name} ${
    gap.highInclusive ? "≤" : "<"
  } ${hi}`;
}

function formatAssignment(
  assignment: Record<string, string>,
  variableById: Map<string, VariableState>,
  valueById: Map<string, EndingVariableValue>
): string {
  const parts: string[] = [];
  for (const [variableId, outcome] of Object.entries(assignment)) {
    const v = variableById.get(variableId);
    const name = v?.name ?? variableId;
    parts.push(`${name} = ${formatOutcome(v, outcome, valueById)}`);
  }
  return parts.join(" & ");
}

function formatOutcome(
  variable: VariableState | undefined,
  outcome: string,
  valueById: Map<string, EndingVariableValue>
): string {
  if (outcome === UNSET_TEXT_OUTCOME) return "unset";
  if (outcome === TIE_OUTCOME) return "tie";
  if (variable?.kind === "text") {
    return valueById.get(outcome)?.value ?? outcome;
  }
  if (variable?.kind === "aggregate_ref" && variable.aggregate_ref) {
    const cols = AGGREGATE_OPTIONS_BY_REF[variable.aggregate_ref] ?? [];
    if (cols.length === 2) {
      // class_affinity outcomes are "top|bottom"; render as "top wins"
      // since the bottom is implied.
      const [top] = outcome.split("|");
      return `${labelForCol(top)} top`;
    }
    // nation_affinity outcomes are "top|bottom"; bottom may be 'tie'.
    const [top, bottom] = outcome.split("|");
    if (bottom === TIE_OUTCOME) return `${labelForCol(top)} top, tied bottom`;
    if (top === TIE_OUTCOME) return `tied top, ${labelForCol(bottom)} bottom`;
    return `${labelForCol(top)} top, ${labelForCol(bottom)} bottom`;
  }
  return outcome;
}

function labelForCol(col: string): string {
  return (VARIABLE_LABELS as Record<string, string>)[col] ?? col;
}
