"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import {
  EMPTY_SELECTIONS,
  evaluateFramework,
  shadowedRowIds,
  type EvalBlock,
  type EvalChip,
  type EvalRow,
  type EvalVariable,
  type PreviewSelections,
} from "@/lib/endings/evaluator";
import type {
  BlockState,
  ChipState,
  RowState,
  VariableState,
} from "@/lib/endings/block-state";
import type { EndingVariableValue } from "@/lib/db/types";

export function PreviewView({
  name,
  blocks,
  rows,
  chips,
  variables,
  referencedVariables,
  values,
  selections,
  onChangeText,
  onChangeNumber,
}: {
  name: string;
  blocks: BlockState[];
  rows: RowState[];
  chips: ChipState[];
  variables: VariableState[];
  referencedVariables: VariableState[];
  values: EndingVariableValue[];
  selections: PreviewSelections;
  onChangeText: (variableId: string, valueId: string | null) => void;
  onChangeNumber: (variableId: string, value: number | null) => void;
}) {
  // Build the impact-column → variable_id map once. Aggregate chips need
  // it to look the underlying scores out of `selections.numbers`.
  const numberRefByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of variables) {
      if (v.kind === "number_ref" && v.number_ref) {
        m.set(v.number_ref, v.id);
      }
    }
    return m;
  }, [variables]);

  const evalInputs = useMemo(
    () => ({
      blocks: blocks as EvalBlock[],
      rows: rows as EvalRow[],
      chips: chips as EvalChip[],
      variables: variables.map(
        (v): EvalVariable => ({
          id: v.id,
          kind: v.kind,
          aggregate_ref: v.aggregate_ref,
        })
      ),
      selections: {
        ...(selections ?? EMPTY_SELECTIONS),
        numberRefByName,
      },
    }),
    [blocks, rows, chips, variables, selections, numberRefByName]
  );
  const paragraphs = useMemo(() => evaluateFramework(evalInputs), [evalInputs]);
  const shadowed = useMemo(() => {
    const ids = shadowedRowIds(evalInputs);
    if (ids.size === 0) return [];
    const rowById = new Map(rows.map((r) => [r.id, r]));
    return [...ids]
      .map((id) => rowById.get(id))
      .filter((r): r is RowState => Boolean(r))
      .map((row) => ({
        row,
        summary: chipSummary(
          (chips as ChipState[]).filter((c) => c.row_id === row.id),
          variables,
          values
        ),
      }));
  }, [evalInputs, chips, rows, values, variables]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {referencedVariables.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Set variable values
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {referencedVariables
              .filter((v) => v.kind !== "aggregate_ref")
              .map((v) => (
              <div
                key={v.id}
                className="grid grid-cols-[1fr_1fr] items-center gap-2"
              >
                <Label className="!text-xs">{v.name}</Label>
                {v.kind === "text" ? (
                  <Select
                    aria-label={v.name}
                    value={selections.textValueIds[v.id] ?? ""}
                    onChange={(e) =>
                      onChangeText(v.id, e.target.value || null)
                    }
                    className={cn("h-8", GHOST_FIELD)}
                  >
                    <option value="">—</option>
                    {values
                      .filter((val) => val.variable_id === v.id)
                      .map((val) => (
                        <option key={val.id} value={val.id}>
                          {val.value}
                        </option>
                      ))}
                  </Select>
                ) : (
                  <Input
                    aria-label={v.name}
                    type="number"
                    value={
                      selections.numbers[v.id] == null
                        ? ""
                        : String(selections.numbers[v.id])
                    }
                    onChange={(e) => {
                      const raw = e.target.value;
                      onChangeNumber(
                        v.id,
                        raw === "" ? null : Number(raw)
                      );
                    }}
                    className={cn("h-8", GHOST_FIELD)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {shadowed.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
          <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" />
          <div className="flex flex-col gap-1">
            <span className="font-mono uppercase tracking-widest text-[10px]">
              {shadowed.length} row{shadowed.length === 1 ? "" : "s"} shadowed
              by first-match-wins
            </span>
            <ul className="flex flex-col gap-0.5 text-amber-100/80">
              {shadowed.map(({ row, summary }) => (
                <li key={row.id} className="font-mono">
                  · {summary || "(empty row)"}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <article className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {name || "(unnamed framework)"}
        </h3>
        {paragraphs.length === 0 ? (
          <p className="italic text-muted-foreground/80">
            (no blocks to render)
          </p>
        ) : (
          paragraphs.map((para, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {para}
            </p>
          ))
        )}
      </article>
    </div>
  );
}

function chipSummary(
  chips: ChipState[],
  variables: VariableState[],
  values: EndingVariableValue[]
): string {
  if (chips.length === 0) return "";
  const sorted = [...chips].sort((a, b) => a.sort_order - b.sort_order);
  const varById = new Map(variables.map((v) => [v.id, v]));
  const valueById = new Map(values.map((v) => [v.id, v]));
  return sorted
    .map((chip) => {
      const variable = varById.get(chip.variable_id);
      if (!variable) return "?";
      const value =
        variable.kind === "text"
          ? valueById.get(chip.text_value_id ?? "")?.value ?? "—"
          : chip.number_value == null
          ? "—"
          : String(chip.number_value);
      return `${variable.name} ${chip.operator} ${value}`;
    })
    .join(" & ");
}
