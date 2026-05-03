"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import {
  EMPTY_SELECTIONS,
  evaluateFramework,
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
  const paragraphs = useMemo(
    () =>
      evaluateFramework({
        blocks: blocks as EvalBlock[],
        rows: rows as EvalRow[],
        chips: chips as EvalChip[],
        variables: variables.map(
          (v): EvalVariable => ({ id: v.id, kind: v.kind })
        ),
        selections: selections ?? EMPTY_SELECTIONS,
      }),
    [blocks, rows, chips, variables, selections]
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {referencedVariables.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Set variable values
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {referencedVariables.map((v) => (
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
