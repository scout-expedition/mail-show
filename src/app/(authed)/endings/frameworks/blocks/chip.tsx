"use client";

import { useContext, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { PickerCtx } from "../lib/picker";

function chipColor(variable: VariableState): string {
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
  values,
  onChange,
  onRemove,
}: {
  chip: ChipState;
  variable: VariableState | null;
  values: EndingVariableValue[];
  onChange: (patch: Partial<ChipState>) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState<"none" | "op" | "value">("none");
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

  const color = chipColor(variable);
  const allowedOps = ENDING_OPERATORS_BY_KIND[variable.kind];
  const aggregateOptions =
    variable.kind === "aggregate_ref" && variable.aggregate_ref
      ? AGGREGATE_OPTIONS_BY_REF[variable.aggregate_ref]
      : [];
  let valueLabel: string;
  if (variable.kind === "text") {
    valueLabel = values.find((v) => v.id === chip.text_value_id)?.value ?? "—";
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
      <span className="font-mono uppercase">{chipDisplayName(variable)}</span>

      {editing === "op" ? (
        <Select
          autoFocus
          value={chip.operator}
          onChange={(e) => {
            onChange({ operator: e.target.value as EndingChipOperator });
            setEditing("none");
          }}
          onBlur={() => setEditing("none")}
          className="h-5 !min-w-0 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
        >
          {allowedOps.map((op) => (
            <option key={op} value={op}>
              {operatorLabel(op)}
            </option>
          ))}
        </Select>
      ) : (
        <button
          type="button"
          onClick={() => allowedOps.length > 1 && setEditing("op")}
          className="opacity-60 hover:opacity-100"
          title={allowedOps.length > 1 ? "Change operator" : undefined}
        >
          {operatorLabel(chip.operator)}
        </button>
      )}

      {editing === "value" ? (
        variable.kind === "text" ? (
          <Select
            autoFocus
            value={chip.text_value_id ?? ""}
            onChange={(e) => {
              onChange({ text_value_id: e.target.value || null });
              setEditing("none");
            }}
            onBlur={() => setEditing("none")}
            className="h-5 !min-w-0 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
          >
            <option value="">—</option>
            {values
              .filter((v) => v.variable_id === variable.id)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.value}
                </option>
              ))}
          </Select>
        ) : variable.kind === "number_ref" ? (
          <Input
            autoFocus
            type="number"
            value={chip.number_value == null ? "" : String(chip.number_value)}
            onChange={(e) => {
              const raw = e.target.value;
              onChange({
                number_value: raw === "" ? null : Number(raw),
              });
            }}
            onBlur={() => setEditing("none")}
            className="h-5 w-16 !min-w-0 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
          />
        ) : (
          <Select
            autoFocus
            value={chip.aggregate_value ?? ""}
            onChange={(e) => {
              onChange({ aggregate_value: e.target.value || null });
              setEditing("none");
            }}
            onBlur={() => setEditing("none")}
            className="h-5 !min-w-0 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
          >
            <option value="">—</option>
            {aggregateOptions.map((col) => (
              <option key={col} value={col}>
                {aggregateOptionLabel(col)}
              </option>
            ))}
          </Select>
        )
      ) : (
        <button
          type="button"
          onClick={() => setEditing("value")}
          className="font-mono uppercase underline-offset-2 hover:underline"
        >
          {valueLabel}
        </button>
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
];

/**
 * "+ chip" inline picker. After picking a variable, the operator dropdown
 * is filtered by variable kind, and the value control switches between a
 * value select (text), a numeric input (number_ref), and a class/nation
 * select (aggregate_ref).
 */
export function AddChipButton({
  variables,
  values,
  onAdd,
}: {
  variables: VariableState[];
  values: EndingVariableValue[];
  onAdd: (input: AddChipInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [variableId, setVariableId] = useState<string>("");
  const [operator, setOperator] = useState<EndingChipOperator>("=");
  const [textValueId, setTextValueId] = useState<string>("");
  const [numberValue, setNumberValue] = useState<string>("");
  const [aggregateValue, setAggregateValue] = useState<string>("");
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
    setVariableId("");
    setOperator("=");
    setTextValueId("");
    setNumberValue("");
    setAggregateValue("");
  }

  const variable = variables.find((v) => v.id === variableId) ?? null;
  const allowedOps = variable
    ? ENDING_OPERATORS_BY_KIND[variable.kind]
    : ENDING_CHIP_OPERATORS;
  const eligibleValues = values.filter((v) => v.variable_id === variableId);
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

  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]">
      <Select
        value={variableId}
        onChange={(e) => {
          const next = e.target.value;
          setVariableId(next);
          const picked = variables.find((v) => v.id === next) ?? null;
          // Reset op when the variable changes — allowed-ops depend on kind.
          if (picked?.kind === "aggregate_ref") {
            setOperator("top=");
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
      </Select>

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
          onChange={(e) => setTextValueId(e.target.value)}
          disabled={!variableId}
          className="h-7 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
        >
          <option value="">value…</option>
          {eligibleValues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.value}
            </option>
          ))}
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
