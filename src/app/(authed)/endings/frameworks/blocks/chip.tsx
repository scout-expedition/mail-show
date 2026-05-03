"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { paletteColor } from "@/lib/endings/color-palette";
import {
  ENDING_CHIP_OPERATORS,
  ENDING_OPERATORS_BY_KIND,
  type EndingChipOperator,
} from "@/lib/db/enums";
import type { ChipState, VariableState } from "@/lib/endings/block-state";
import type { EndingVariableValue } from "@/lib/db/types";

export interface AddChipInput {
  variable_id: string;
  operator: EndingChipOperator;
  text_value_id: string | null;
  number_value: number | null;
}

/**
 * Chip pill. For text variables: `[VAR] [op] [VALUE]` with op + value
 * editable inline. For number_ref variables: `[VAR] [op] [number]` with
 * op + number editable inline. Removing the chip is the × icon.
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

  const color = paletteColor(variable.color_index);
  const allowedOps = ENDING_OPERATORS_BY_KIND[variable.kind];
  const valueLabel =
    variable.kind === "text"
      ? values.find((v) => v.id === chip.text_value_id)?.value ?? "—"
      : chip.number_value == null
      ? "—"
      : String(chip.number_value);

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        borderColor: color,
        color,
        backgroundColor: `${color}1a`,
      }}
    >
      <span className="font-mono uppercase">{variable.name}</span>

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
              {op}
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
          {chip.operator}
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
        ) : (
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

/**
 * "+ chip" inline picker. After picking a variable, the operator dropdown
 * is filtered by variable kind, and the value control switches between a
 * value select (text) and a numeric input (number_ref).
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

  function reset() {
    setOpen(false);
    setVariableId("");
    setOperator("=");
    setTextValueId("");
    setNumberValue("");
  }

  const variable = variables.find((v) => v.id === variableId) ?? null;
  const allowedOps = variable
    ? ENDING_OPERATORS_BY_KIND[variable.kind]
    : ENDING_CHIP_OPERATORS;
  const eligibleValues = values.filter((v) => v.variable_id === variableId);

  function handleConfirm() {
    if (!variable) return;
    if (variable.kind === "text") {
      if (!textValueId) return;
      onAdd({
        variable_id: variableId,
        operator,
        text_value_id: textValueId,
        number_value: null,
      });
    } else {
      if (numberValue === "" || Number.isNaN(Number(numberValue))) return;
      onAdd({
        variable_id: variableId,
        operator,
        text_value_id: null,
        number_value: Number(numberValue),
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

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]">
      <Select
        value={variableId}
        onChange={(e) => {
          const next = e.target.value;
          setVariableId(next);
          // Reset op/value when the variable changes — operator allowed-set
          // and value control depend on it.
          setOperator("=");
          setTextValueId("");
          setNumberValue("");
        }}
        className="h-5 !min-w-0 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
      >
        <option value="">var…</option>
        {variables.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.kind === "number_ref" ? " #" : ""}
          </option>
        ))}
      </Select>

      <Select
        value={operator}
        onChange={(e) => setOperator(e.target.value as EndingChipOperator)}
        disabled={!variableId}
        className="h-5 !min-w-0 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
      >
        {allowedOps.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </Select>

      {variable && variable.kind === "number_ref" ? (
        <Input
          type="number"
          value={numberValue}
          onChange={(e) => setNumberValue(e.target.value)}
          placeholder="0"
          className="h-5 w-16 !min-w-0 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
        />
      ) : (
        <Select
          value={textValueId}
          onChange={(e) => setTextValueId(e.target.value)}
          disabled={!variableId}
          className="h-5 !min-w-0 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
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
            (numberValue === "" || Number.isNaN(Number(numberValue))))
        }
        className="rounded px-1 text-[11px] text-primary disabled:opacity-50"
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
