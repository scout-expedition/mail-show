"use client";

import { useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  BlockState,
  ChipState,
  RowState,
  VariableState,
} from "@/lib/endings/block-state";
import { AGGREGATE_OPTIONS_BY_REF } from "@/lib/db/enums";
import { TIE_OUTCOME, UNSET_TEXT_OUTCOME } from "@/lib/endings/static-analysis";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";
import type { EndingVariableValue } from "@/lib/db/types";
import { addChip, addRow, removeChip, removeRow } from "../actions";
import { useDrag, type DragTarget } from "../lib/drag";
import { useAnalysis } from "../lib/analysis";
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
  const analysis = useAnalysis();
  const isDragging = drag.dragId === block.id;
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(false);
  const [uncoveredOpen, setUncoveredOpen] = useState(false);
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
          {blockAnalysis ? (
            <BlockAnalysisBadge
              analysis={blockAnalysis}
              variables={variables}
              values={values}
              open={uncoveredOpen}
              onToggle={() => setUncoveredOpen((v) => !v)}
            />
          ) : null}
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
      <div className="flex flex-col gap-1.5">
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
  shadowedByOrdinal,
  overlap,
  rowSortOrder,
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
  shadowedByOrdinal: number | null;
  overlap: import("@/lib/endings/static-analysis").NumericRowOverlap | null;
  rowSortOrder: Map<string, number>;
  onAddChip: (input: AddChipInput) => void;
  onRemoveChip: (chipId: string) => void;
  onChangeChip: (chipId: string, patch: Partial<ChipState>) => void;
  onRemoveRow: () => void;
  children: React.ReactNode;
}) {
  const fullyOverlapped = overlap?.fullShadow ?? false;
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(160px,260px)_1fr_auto] gap-2 rounded-md border border-border/60 bg-card/40 p-2",
        (shadowedByOrdinal != null || fullyOverlapped) &&
          "border-amber-500/50 bg-amber-500/5"
      )}
    >
      <div className="flex flex-wrap items-start gap-1 self-start">
        {chips.length === 0 ? null : (
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
        {shadowedByOrdinal != null ? (
          <span
            title={`This row's chips are fully covered by row ${shadowedByOrdinal}, so first-match-wins means it can never fire.`}
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-amber-200"
          >
            <AlertTriangle size={10} aria-hidden />
            shadowed by row {shadowedByOrdinal}
          </span>
        ) : null}
        {overlap ? (
          <OverlapBadge
            overlap={overlap}
            variableIndex={variableIndex}
            rowSortOrder={rowSortOrder}
          />
        ) : null}
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
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-amber-200 hover:bg-amber-500/20"
    >
      <AlertTriangle size={10} aria-hidden />
      {count}
      {partialSuffix} {count === 1 ? "assignment" : "assignments"} uncovered
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
