"use client";

import { useContext, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { paletteColor } from "@/lib/endings/color-palette";
import { AFFINITY_NUMBER_REFS } from "@/lib/endings/impact-colors";
import {
  AGGREGATE_OPERATOR_LABELS,
  AGGREGATE_OPTIONS_BY_REF,
  ENDING_CHIP_OPERATORS,
  ENDING_OPERATORS_BY_KIND,
  type AggregateRef,
  type EndingChipOperator,
} from "@/lib/db/enums";
import type { ChipState, VariableState } from "@/lib/endings/block-state";
import type { EndingVariableValue } from "@/lib/db/types";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";
import { PickerCtx } from "../_shared/lib/picker";
import {
  CREATE_VALUE_SENTINEL,
  CREATE_VARIABLE_SENTINEL,
  InlineCreateValueForm,
  InlineCreateVariableForm,
} from "./inline-create-variable";

/**
 * Operators allowed on a particular variable. For aggregate_ref
 * variables the operator set is partitioned by `aggregate_ref`:
 *   - `nation_tiebreak_set` → `set_includes` / `set_excludes` only.
 *   - `class_affinity` / `nation_affinity` → `top=` / `top≠` /
 *     `bottom=` / `bottom≠` only.
 * Text and number_ref variables fall back to their kind defaults.
 */
function allowedOperatorsFor(variable: VariableState): EndingChipOperator[] {
  if (variable.kind !== "aggregate_ref") {
    return ENDING_OPERATORS_BY_KIND[variable.kind];
  }
  const base = ENDING_OPERATORS_BY_KIND.aggregate_ref;
  if (variable.aggregate_ref === "nation_tiebreak_set") {
    return base.filter(
      (op) => op === "set_includes" || op === "set_excludes"
    );
  }
  return base.filter(
    (op) => op !== "set_includes" && op !== "set_excludes"
  );
}

function chipColor(
  chip: ChipState,
  variable: VariableState,
  allVariables: VariableState[]
): string {
  // Aggregate chips inherit the underlying class/nation color. The
  // aggregate_value (e.g. "proletariat", "folos") names an impact
  // column; the seeded number_ref variable wrapping that column already
  // carries the right color_hex. Fall back to white when the chip
  // hasn't committed a value yet (shouldn't happen in practice — the
  // picker requires a value before ✓).
  if (variable.kind === "aggregate_ref") {
    if (!chip.aggregate_value) return "#ffffff";
    const target = allVariables.find(
      (v) =>
        v.kind === "number_ref" && v.number_ref === chip.aggregate_value
    );
    return target?.color_hex ?? "#ffffff";
  }
  return variable.color_hex ?? paletteColor(variable.color_index);
}

function chipDisplayName(variable: VariableState): string {
  if (
    variable.kind === "number_ref" &&
    variable.number_ref &&
    AFFINITY_NUMBER_REFS.has(variable.number_ref)
  ) {
    return `${variable.name} Affinity`;
  }
  return variable.name;
}

function aggregateOptionLabel(col: string): string {
  return (VARIABLE_LABELS as Record<string, string>)[col] ?? col;
}

/**
 * Grouped layout for the chip-picker variable dropdown. Text variables
 * render first (ungrouped); the seeded number_ref impact columns are
 * grouped semantically. Combined Nat'l is excluded — it's a derived
 * meta-variable, not authoring-facing.
 */
const NUMBER_REF_GROUPS: Array<{ label: string; columns: string[] }> = [
  { label: "Impact", columns: ["world_status", "demerits"] },
  { label: "Class Affinity", columns: ["proletariat", "gentry"] },
  {
    label: "Nation Affinity",
    columns: ["epicenter", "folos", "emberlyn", "spokgrad", "pelico"],
  },
];

export interface AddChipInput {
  variable_id: string;
  operator: EndingChipOperator;
  text_value_id: string | null;
  number_value: number | null;
  aggregate_value: string | null;
}

/**
 * Operator label as shown on the chip pill. Aggregate operators get a
 * human-readable label ("top is", "top is not", …); the rest render the
 * raw symbol.
 */
function operatorLabel(op: EndingChipOperator): string {
  return AGGREGATE_OPERATOR_LABELS[op] ?? op;
}

/**
 * Chip pill. For text variables: `[VAR] [op] [VALUE]` with op + value
 * editable inline. For number_ref variables: `[VAR] [op] [number]` with
 * op + number editable inline. For aggregate variables:
 * `[VAR] [top is | …] [Working Class | …]`.
 * Removing the chip is the × icon.
 */
export function ChipPill({
  chip,
  variable,
  variables,
  values,
  compact = false,
  onChange,
  onRemove,
}: {
  chip: ChipState;
  variable: VariableState | null;
  /** All known variables — used to resolve the underlying number_ref
   *  color for aggregate chips (the chip's aggregate_value names a
   *  class/nation impact column). */
  variables: VariableState[];
  values: EndingVariableValue[];
  /** When true, omit the variable name from the pill — used in slot mode
   *  where the column already identifies the variable. */
  compact?: boolean;
  onChange: (patch: Partial<ChipState>) => void;
  onRemove: () => void;
}) {
  const [creatingValue, setCreatingValue] = useState(false);
  const [optimisticValue, setOptimisticValue] = useState<
    { id: string; text: string } | null
  >(null);

  if (!variable) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
        missing variable
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove chip"
          className="text-destructive/80 hover:text-destructive"
        >
          <X size={10} aria-hidden />
        </button>
      </span>
    );
  }

  if (creatingValue && variable.kind === "text") {
    return (
      <InlineCreateValueForm
        variableId={variable.id}
        onCreated={({ valueId, value }) => {
          setOptimisticValue({ id: valueId, text: value });
          onChange({ text_value_id: valueId });
          setCreatingValue(false);
        }}
        onCancel={() => setCreatingValue(false)}
      />
    );
  }

  const color = chipColor(chip, variable, variables);
  const allowedOps = allowedOperatorsFor(variable);
  const aggregateOptions =
    variable.kind === "aggregate_ref" && variable.aggregate_ref
      ? AGGREGATE_OPTIONS_BY_REF[variable.aggregate_ref]
      : [];
  let valueLabel: string;
  if (variable.kind === "text") {
    const found = values.find((v) => v.id === chip.text_value_id);
    if (found) valueLabel = found.value;
    else if (optimisticValue && optimisticValue.id === chip.text_value_id)
      valueLabel = optimisticValue.text;
    else valueLabel = "—";
  } else if (variable.kind === "number_ref") {
    valueLabel = chip.number_value == null ? "—" : String(chip.number_value);
  } else {
    valueLabel = chip.aggregate_value
      ? aggregateOptionLabel(chip.aggregate_value)
      : "—";
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        borderColor: color,
        color,
        backgroundColor: `${color}1a`,
      }}
    >
      {compact ? null : (
        <span className="font-mono uppercase">{chipDisplayName(variable)}</span>
      )}

      {/*
        Operator + value render as static text with an invisible <select>
        overlaid on top — a click reaches the select (system dropdown
        opens immediately), and selecting an option fires onChange which
        updates the visible text. Native <select> with appearance-none
        still reserves chevron padding internally, so this overlay pattern
        keeps the chip's layout tight while preserving the native menu.
        Numbers stay as an inline Input you can type into directly.
      */}
      <span
        className={cn(
          "relative inline-flex items-center font-mono uppercase",
          allowedOps.length > 1 && "cursor-pointer hover:opacity-100",
          allowedOps.length > 1 ? "opacity-80" : "opacity-100"
        )}
      >
        <span
          aria-hidden
          // Word-style operators ("top is", "bottom is not", …) are
          // longer than the single-symbol ops (`=`, `<`, …); render them
          // ~⅔ the size so the chip stays compact and the symbol ops
          // don't look oddly small next to them.
          className={
            AGGREGATE_OPERATOR_LABELS[chip.operator] != null
              ? "text-[8px]"
              : undefined
          }
        >
          {operatorLabel(chip.operator)}
        </span>
        {allowedOps.length > 1 ? (
          <select
            value={chip.operator}
            onChange={(e) =>
              onChange({ operator: e.target.value as EndingChipOperator })
            }
            aria-label="Operator"
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {allowedOps.map((op) => (
              <option key={op} value={op}>
                {operatorLabel(op)}
              </option>
            ))}
          </select>
        ) : null}
      </span>

      {variable.kind === "text" ? (
        <span className="relative inline-flex items-center font-mono uppercase">
          <span aria-hidden>{valueLabel}</span>
          <select
            value={chip.text_value_id ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              if (next === CREATE_VALUE_SENTINEL) {
                setCreatingValue(true);
                return;
              }
              onChange({ text_value_id: next || null });
            }}
            aria-label="Value"
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="">—</option>
            {values
              .filter((v) => v.variable_id === variable.id)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.value}
                </option>
              ))}
            {optimisticValue &&
            !values.some((v) => v.id === optimisticValue.id) ? (
              <option key={optimisticValue.id} value={optimisticValue.id}>
                {optimisticValue.text}
              </option>
            ) : null}
            <option value={CREATE_VALUE_SENTINEL}>+ New value…</option>
          </select>
        </span>
      ) : variable.kind === "number_ref" ? (
        <Input
          type="number"
          value={chip.number_value == null ? "" : String(chip.number_value)}
          onChange={(e) => {
            const raw = e.target.value;
            onChange({ number_value: raw === "" ? null : Number(raw) });
          }}
          className="h-auto w-16 border-0 bg-transparent p-0 font-mono text-[11px] shadow-none focus:!ring-0"
        />
      ) : (
        <span className="relative inline-flex items-center font-mono uppercase">
          <span aria-hidden>{valueLabel}</span>
          <select
            value={chip.aggregate_value ?? ""}
            onChange={(e) =>
              onChange({ aggregate_value: e.target.value || null })
            }
            aria-label="Value"
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="">—</option>
            {aggregateOptions.map((col) => (
              <option key={col} value={col}>
                {aggregateOptionLabel(col)}
              </option>
            ))}
          </select>
        </span>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove chip"
        className="ml-0.5 opacity-50 hover:opacity-100"
      >
        <X size={10} aria-hidden />
      </button>
    </span>
  );
}

const AGGREGATE_OPTIONS: Array<{
  ref: AggregateRef;
  label: string;
}> = [
  { ref: "class_affinity", label: "Class Affinity" },
  { ref: "nation_affinity", label: "Nation Affinity" },
  { ref: "nation_tiebreak_set", label: "Tiebreak Set" },
];

/**
 * Always-open inline form for filling out a chip on a pre-pinned variable.
 * Used by RowChipAdder when the author has chosen which variable to chip
 * on. Opening / closing is the caller's responsibility.
 */
export function ChipPickerForm({
  pinnedVariable,
  values,
  onConfirm,
  onCancel,
}: {
  pinnedVariable: VariableState;
  values: EndingVariableValue[];
  onConfirm: (input: AddChipInput) => void;
  onCancel: () => void;
}) {
  const variable = pinnedVariable;
  const [operator, setOperator] = useState<EndingChipOperator>(
    variable.kind === "aggregate_ref"
      ? variable.aggregate_ref === "nation_tiebreak_set"
        ? "set_includes"
        : "top="
      : "="
  );
  const [textValueId, setTextValueId] = useState<string>("");
  const [numberValue, setNumberValue] = useState<string>(
    variable.kind === "number_ref" ? "0" : ""
  );
  const [aggregateValue, setAggregateValue] = useState<string>(
    variable.kind === "aggregate_ref" && variable.aggregate_ref
      ? AGGREGATE_OPTIONS_BY_REF[variable.aggregate_ref]?.[0] ?? ""
      : ""
  );
  const [creatingValue, setCreatingValue] = useState(false);
  const [optimisticValue, setOptimisticValue] = useState<
    { id: string; text: string } | null
  >(null);
  const picker = useContext(PickerCtx);

  // Track this picker's open state with the editor so Save knows whether
  // any picker is mid-pick (and stays disabled until ✓ or ✕).
  useEffect(() => {
    picker.register();
    return () => picker.unregister();
  }, [picker]);

  if (creatingValue) {
    return (
      <InlineCreateValueForm
        variableId={variable.id}
        onCreated={({ valueId, value }) => {
          setOptimisticValue({ id: valueId, text: value });
          setTextValueId(valueId);
          setCreatingValue(false);
        }}
        onCancel={() => setCreatingValue(false)}
      />
    );
  }

  const allowedOps = allowedOperatorsFor(variable);
  const eligibleValues = [
    ...values.filter((v) => v.variable_id === variable.id),
    ...(optimisticValue &&
    !values.some((v) => v.id === optimisticValue.id)
      ? [
          {
            id: optimisticValue.id,
            variable_id: variable.id,
            value: optimisticValue.text,
            sort_order: 9999,
          },
        ]
      : []),
  ];
  const aggregateOptions =
    variable.kind === "aggregate_ref" && variable.aggregate_ref
      ? AGGREGATE_OPTIONS_BY_REF[variable.aggregate_ref]
      : [];

  function handleConfirm() {
    if (variable.kind === "text") {
      if (!textValueId) return;
      onConfirm({
        variable_id: variable.id,
        operator,
        text_value_id: textValueId,
        number_value: null,
        aggregate_value: null,
      });
    } else if (variable.kind === "number_ref") {
      if (numberValue === "" || Number.isNaN(Number(numberValue))) return;
      onConfirm({
        variable_id: variable.id,
        operator,
        text_value_id: null,
        number_value: Number(numberValue),
        aggregate_value: null,
      });
    } else {
      if (!aggregateValue) return;
      onConfirm({
        variable_id: variable.id,
        operator,
        text_value_id: null,
        number_value: null,
        aggregate_value: aggregateValue,
      });
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]">
      <span className="px-1 font-mono uppercase tracking-widest text-[10px] opacity-70">
        {variable.name}
      </span>
      <Select
        value={operator}
        onChange={(e) => setOperator(e.target.value as EndingChipOperator)}
        className="h-7 w-24 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
      >
        {allowedOps.map((op) => (
          <option key={op} value={op}>
            {operatorLabel(op)}
          </option>
        ))}
      </Select>
      {variable.kind === "number_ref" ? (
        <Input
          type="number"
          value={numberValue}
          onChange={(e) => setNumberValue(e.target.value)}
          placeholder="0"
          className="h-7 w-20 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
        />
      ) : variable.kind === "aggregate_ref" ? (
        <Select
          value={aggregateValue}
          onChange={(e) => setAggregateValue(e.target.value)}
          className="h-7 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
        >
          <option value="">value…</option>
          {aggregateOptions.map((col) => (
            <option key={col} value={col}>
              {aggregateOptionLabel(col)}
            </option>
          ))}
        </Select>
      ) : (
        <Select
          value={textValueId}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CREATE_VALUE_SENTINEL) {
              setCreatingValue(true);
              return;
            }
            setTextValueId(next);
          }}
          className="h-7 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
        >
          <option value="">value…</option>
          {eligibleValues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.value}
            </option>
          ))}
          <option value={CREATE_VALUE_SENTINEL}>+ New value…</option>
        </Select>
      )}
      <button
        type="button"
        onClick={handleConfirm}
        disabled={
          (variable.kind === "text" && !textValueId) ||
          (variable.kind === "number_ref" &&
            (numberValue === "" || Number.isNaN(Number(numberValue)))) ||
          (variable.kind === "aggregate_ref" && !aggregateValue)
        }
        className="ml-auto rounded px-1 text-[11px] text-primary disabled:opacity-50"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel"
        className="opacity-60 hover:opacity-100"
      >
        <X size={10} aria-hidden />
      </button>
    </span>
  );
}

/**
 * "+ chip" inline picker. After picking a variable, the operator dropdown
 * is filtered by variable kind, and the value control switches between a
 * value select (text), a numeric input (number_ref), and a class/nation
 * select (aggregate_ref).
 */
export function AddChipButton({
  variables,
  values,
  pinnedVariable,
  onAdd,
}: {
  variables: VariableState[];
  values: EndingVariableValue[];
  /** When set, the variable picker is hidden and `variableId` is fixed
   *  to this variable. Used by per-slot row authoring (Phase 6). */
  pinnedVariable?: VariableState;
  onAdd: (input: AddChipInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [creatingValue, setCreatingValue] = useState(false);
  const [optimisticValueOnExisting, setOptimisticValueOnExisting] = useState<
    { variableId: string; valueId: string; text: string } | null
  >(null);
  const [variableId, setVariableId] = useState<string>(
    pinnedVariable?.id ?? ""
  );
  const [operator, setOperator] = useState<EndingChipOperator>(
    pinnedVariable?.kind === "aggregate_ref"
      ? pinnedVariable.aggregate_ref === "nation_tiebreak_set"
        ? "set_includes"
        : "top="
      : "="
  );
  const [textValueId, setTextValueId] = useState<string>("");
  const [numberValue, setNumberValue] = useState<string>(
    pinnedVariable?.kind === "number_ref" ? "0" : ""
  );
  const [aggregateValue, setAggregateValue] = useState<string>(
    pinnedVariable?.kind === "aggregate_ref" && pinnedVariable.aggregate_ref
      ? AGGREGATE_OPTIONS_BY_REF[pinnedVariable.aggregate_ref]?.[0] ?? ""
      : ""
  );
  // Optimistic shadow of a just-created variable + first value so the
  // chip picker can keep flowing even before the parent's revalidatePath
  // re-renders with the real variables list.
  const [optimistic, setOptimistic] = useState<
    | { variableId: string; valueId: string; name: string; valueText: string }
    | null
  >(null);
  const picker = useContext(PickerCtx);

  // Track this picker's open state with the editor so Save knows whether
  // any picker is mid-pick (and stays disabled until ✓ or ✕).
  useEffect(() => {
    if (!open) return;
    picker.register();
    return () => picker.unregister();
  }, [open, picker]);

  function reset() {
    setOpen(false);
    setCreatingNew(false);
    setCreatingValue(false);
    setOptimistic(null);
    setOptimisticValueOnExisting(null);
    if (!pinnedVariable) {
      setVariableId("");
      setOperator("=");
      setTextValueId("");
      setNumberValue("");
      setAggregateValue("");
    }
  }

  // Synthesize a transient VariableState for the just-created variable
  // so the picker UI can render its name + value while we wait for the
  // server-side revalidate to bring the real row into `variables`.
  const optimisticVariable: VariableState | null = optimistic
    ? {
        id: optimistic.variableId,
        name: optimistic.name,
        kind: "text",
        number_ref: null,
        aggregate_ref: null,
        default_value_id: optimistic.valueId,
        color_index: 0,
        color_hex: null,
        sort_order: 0,
      }
    : null;
  const optimisticValues: EndingVariableValue[] = optimistic
    ? [
        {
          id: optimistic.valueId,
          variable_id: optimistic.variableId,
          value: optimistic.valueText,
          sort_order: 0,
        },
      ]
    : [];
  const variable =
    variables.find((v) => v.id === variableId) ??
    (optimisticVariable && optimisticVariable.id === variableId
      ? optimisticVariable
      : null);
  const allowedOps = variable ? allowedOperatorsFor(variable) : ENDING_CHIP_OPERATORS;
  const eligibleValues = [
    ...values.filter((v) => v.variable_id === variableId),
    ...optimisticValues.filter((v) => v.variable_id === variableId),
    ...(optimisticValueOnExisting &&
    optimisticValueOnExisting.variableId === variableId &&
    !values.some((v) => v.id === optimisticValueOnExisting.valueId)
      ? [
          {
            id: optimisticValueOnExisting.valueId,
            variable_id: variableId,
            value: optimisticValueOnExisting.text,
            sort_order: 9999,
          },
        ]
      : []),
  ];
  const aggregateOptions =
    variable?.kind === "aggregate_ref" && variable.aggregate_ref
      ? AGGREGATE_OPTIONS_BY_REF[variable.aggregate_ref]
      : [];

  function handleConfirm() {
    if (!variable) return;
    if (variable.kind === "text") {
      if (!textValueId) return;
      onAdd({
        variable_id: variableId,
        operator,
        text_value_id: textValueId,
        number_value: null,
        aggregate_value: null,
      });
    } else if (variable.kind === "number_ref") {
      if (numberValue === "" || Number.isNaN(Number(numberValue))) return;
      onAdd({
        variable_id: variableId,
        operator,
        text_value_id: null,
        number_value: Number(numberValue),
        aggregate_value: null,
      });
    } else {
      if (!aggregateValue) return;
      onAdd({
        variable_id: variableId,
        operator,
        text_value_id: null,
        number_value: null,
        aggregate_value: aggregateValue,
      });
    }
    reset();
  }

  if (!open) {
    if (pinnedVariable) {
      // Slot-mode placeholder — small "+" pill. The header (and the
      // existing chips on the slot) already make the variable obvious,
      // so this stays compact and stops the row from getting noisy.
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Add ${pinnedVariable.name} chip`}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-[11px] leading-none text-muted-foreground hover:bg-accent/40"
        >
          +
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent/40"
      >
        + chip
      </button>
    );
  }

  const textVariables = variables.filter((v) => v.kind === "text");
  const numberVariablesByRef = new Map<string, VariableState>();
  for (const v of variables) {
    if (v.kind === "number_ref" && v.number_ref) {
      numberVariablesByRef.set(v.number_ref, v);
    }
  }
  const aggregateVariablesByRef = new Map<AggregateRef, VariableState>();
  for (const v of variables) {
    if (v.kind === "aggregate_ref" && v.aggregate_ref) {
      aggregateVariablesByRef.set(v.aggregate_ref, v);
    }
  }

  if (creatingNew) {
    return (
      <InlineCreateVariableForm
        onCreated={({ variableId: newId, valueId, name, firstValue }) => {
          // Stash a transient copy so the picker can render the new
          // var/value before the parent re-renders with revalidated data.
          setOptimistic({
            variableId: newId,
            valueId,
            name,
            valueText: firstValue,
          });
          setVariableId(newId);
          setOperator("=");
          setTextValueId(valueId);
          setNumberValue("");
          setAggregateValue("");
          setCreatingNew(false);
        }}
        onCancel={() => setCreatingNew(false)}
      />
    );
  }

  if (creatingValue && variableId) {
    return (
      <InlineCreateValueForm
        variableId={variableId}
        onCreated={({ valueId, value }) => {
          setOptimisticValueOnExisting({
            variableId,
            valueId,
            text: value,
          });
          setTextValueId(valueId);
          setCreatingValue(false);
        }}
        onCancel={() => setCreatingValue(false)}
      />
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]">
      {pinnedVariable ? (
        <span className="px-1 font-mono uppercase tracking-widest text-[10px] opacity-70">
          {pinnedVariable.name}
        </span>
      ) : (
      <Select
        value={variableId}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CREATE_VARIABLE_SENTINEL) {
            setCreatingNew(true);
            return;
          }
          setVariableId(next);
          const picked = variables.find((v) => v.id === next) ?? null;
          // Reset op when the variable changes — allowed-ops depend
          // on kind + aggregate_ref. Tiebreak Set vars only accept
          // set_includes / set_excludes.
          if (picked?.kind === "aggregate_ref") {
            setOperator(
              picked.aggregate_ref === "nation_tiebreak_set"
                ? "set_includes"
                : "top="
            );
          } else {
            setOperator("=");
          }
          setTextValueId("");
          // For number_ref vars seed the comparison value to 0 so authors
          // get a usable default and don't have to type one.
          setNumberValue(picked?.kind === "number_ref" ? "0" : "");
          // For aggregate vars seed the value to the first option.
          if (picked?.kind === "aggregate_ref" && picked.aggregate_ref) {
            const first =
              AGGREGATE_OPTIONS_BY_REF[picked.aggregate_ref]?.[0] ?? "";
            setAggregateValue(first);
          } else {
            setAggregateValue("");
          }
        }}
        className="h-7 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
      >
        <option value="">variable…</option>
        {textVariables.length > 0 ? (
          <optgroup label="Ending Variables">
            {textVariables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            {optimisticVariable &&
            !textVariables.some((v) => v.id === optimisticVariable.id) ? (
              <option key={optimisticVariable.id} value={optimisticVariable.id}>
                {optimisticVariable.name}
              </option>
            ) : null}
          </optgroup>
        ) : null}
        {NUMBER_REF_GROUPS.map((group) => {
          const opts = group.columns
            .map((col) => numberVariablesByRef.get(col))
            .filter((v): v is VariableState => Boolean(v));
          if (opts.length === 0) return null;
          return (
            <optgroup key={group.label} label={group.label}>
              {opts.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          );
        })}
        {aggregateVariablesByRef.size > 0 ? (
          <optgroup label="Aggregates">
            {AGGREGATE_OPTIONS.map(({ ref, label }) => {
              const v = aggregateVariablesByRef.get(ref);
              if (!v) return null;
              return (
                <option key={v.id} value={v.id}>
                  {label}
                </option>
              );
            })}
          </optgroup>
        ) : null}
        <option value={CREATE_VARIABLE_SENTINEL}>+ New variable…</option>
      </Select>
      )}

      <Select
        value={operator}
        onChange={(e) => setOperator(e.target.value as EndingChipOperator)}
        disabled={!variableId}
        className="h-7 w-24 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
      >
        {allowedOps.map((op) => (
          <option key={op} value={op}>
            {operatorLabel(op)}
          </option>
        ))}
      </Select>

      {variable?.kind === "number_ref" ? (
        <Input
          type="number"
          value={numberValue}
          onChange={(e) => setNumberValue(e.target.value)}
          placeholder="0"
          className="h-7 w-20 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
        />
      ) : variable?.kind === "aggregate_ref" ? (
        <Select
          value={aggregateValue}
          onChange={(e) => setAggregateValue(e.target.value)}
          disabled={!variableId}
          className="h-7 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
        >
          <option value="">value…</option>
          {aggregateOptions.map((col) => (
            <option key={col} value={col}>
              {aggregateOptionLabel(col)}
            </option>
          ))}
        </Select>
      ) : (
        <Select
          value={textValueId}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CREATE_VALUE_SENTINEL) {
              setCreatingValue(true);
              return;
            }
            setTextValueId(next);
          }}
          disabled={!variableId}
          className="h-7 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
        >
          <option value="">value…</option>
          {eligibleValues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.value}
            </option>
          ))}
          {variable?.kind === "text" && variableId ? (
            <option value={CREATE_VALUE_SENTINEL}>+ New value…</option>
          ) : null}
        </Select>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={
          !variable ||
          (variable.kind === "text" && !textValueId) ||
          (variable.kind === "number_ref" &&
            (numberValue === "" || Number.isNaN(Number(numberValue)))) ||
          (variable.kind === "aggregate_ref" && !aggregateValue)
        }
        className="ml-auto rounded px-1 text-[11px] text-primary disabled:opacity-50"
      >
        ✓
      </button>
      <button
        type="button"
        onClick={reset}
        aria-label="Cancel"
        className="opacity-60 hover:opacity-100"
      >
        <X size={10} aria-hidden />
      </button>
    </span>
  );
}
