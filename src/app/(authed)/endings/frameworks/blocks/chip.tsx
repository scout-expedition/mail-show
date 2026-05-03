"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { paletteColor } from "@/lib/endings/color-palette";
import type { ChipState, VariableState } from "@/lib/endings/block-state";
import type { EndingVariableValue } from "@/lib/db/types";

/**
 * Chip pill. Phase 1 only handles text variables with the `=` operator,
 * so the visible UI is `[VAR] = [VALUE]`. Operator + numeric chips ride
 * along in Phase 2; the underlying ChipState already supports them.
 */
export function ChipPill({
  chip,
  variable,
  values,
  onChangeValue,
  onRemove,
}: {
  chip: ChipState;
  variable: VariableState | null;
  values: EndingVariableValue[];
  onChangeValue: (text_value_id: string | null) => void;
  onRemove: () => void;
}) {
  const [editingValue, setEditingValue] = useState(false);
  if (!variable) {
    // Variable was deleted out from under the chip. Show a placeholder so
    // the author can remove it.
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
  const value = values.find((v) => v.id === chip.text_value_id);
  const valueLabel = value?.value ?? "—";

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
      <span className="opacity-60">{chip.operator}</span>
      {editingValue ? (
        <Select
          autoFocus
          value={chip.text_value_id ?? ""}
          onChange={(e) => {
            onChangeValue(e.target.value || null);
            setEditingValue(false);
          }}
          onBlur={() => setEditingValue(false)}
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
        <button
          type="button"
          onClick={() => setEditingValue(true)}
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
 * "+ chip" inline picker. Pops a variable + value selector and inserts a
 * new chip on save. Phase 1 always uses operator='='.
 */
export function AddChipButton({
  variables,
  values,
  onAdd,
}: {
  variables: VariableState[];
  values: EndingVariableValue[];
  onAdd: (variable_id: string, text_value_id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [variableId, setVariableId] = useState<string>("");
  const [valueId, setValueId] = useState<string>("");

  function reset() {
    setOpen(false);
    setVariableId("");
    setValueId("");
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

  const eligibleValues = values.filter((v) => v.variable_id === variableId);

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]">
      <Select
        value={variableId}
        onChange={(e) => {
          setVariableId(e.target.value);
          setValueId("");
        }}
        className="h-5 !min-w-0 border-0 bg-transparent px-1 text-[11px] focus:!ring-0"
      >
        <option value="">var…</option>
        {variables
          .filter((v) => v.kind === "text")
          .map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
      </Select>
      <span className="opacity-60">=</span>
      <Select
        value={valueId}
        onChange={(e) => setValueId(e.target.value)}
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
      <button
        type="button"
        onClick={() => {
          if (variableId && valueId) {
            onAdd(variableId, valueId);
            reset();
          }
        }}
        disabled={!variableId || !valueId}
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
