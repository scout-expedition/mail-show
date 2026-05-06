"use client";

import { useMemo } from "react";
import { AlertTriangle, Dice5 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import {
  EMPTY_SELECTIONS,
  evaluateDocument,
  evaluateFramework,
  shadowedRowIds,
  type EvalBlock,
  type EvalChip,
  type EvalInputs,
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
import {
  AGGREGATE_OPTIONS_BY_REF,
  RANDOM_RESULT_SENTINEL,
  TIEBREAK_KIND_BY_REF_SIDE,
  type AggregateRef,
  type EndingLogicKind,
} from "@/lib/db/enums";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";

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
  tiebreakInputs,
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
  tiebreakInputs?: Map<EndingLogicKind, EvalInputs>;
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
        tiebreak_docs: tiebreakInputs,
      },
    }),
    [blocks, rows, chips, variables, selections, numberRefByName, tiebreakInputs]
  );
  const paragraphs = useMemo(() => evaluateFramework(evalInputs), [evalInputs]);

  // Aggregate ties surfaced on the framework's referenced chips. For
  // each unique (ref, side) the framework branches on, peek at the
  // underlying scores: when 2+ options share the extreme value, list
  // them and (if a tiebreak doc is set) show the resolved winner.
  const tieIndicators = useMemo(() => {
    type Indicator = {
      key: string;
      refLabel: string;
      side: "top" | "bottom";
      tiedLabels: string[];
      resolved:
        | { kind: "value"; label: string }
        | { kind: "random"; pool: string[] }
        | { kind: "unresolved" };
    };
    const out: Indicator[] = [];
    const seen = new Set<string>();
    for (const c of chips) {
      const variable = variables.find((v) => v.id === c.variable_id);
      if (!variable || variable.kind !== "aggregate_ref") continue;
      const ref = variable.aggregate_ref as AggregateRef | null;
      if (!ref) continue;
      const op = c.operator;
      const side: "top" | "bottom" =
        op === "top=" || op === "top≠" ? "top" : "bottom";
      const key = `${ref}|${side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cols = AGGREGATE_OPTIONS_BY_REF[ref];
      const vals: (number | null)[] = cols.map((col) => {
        const vid = numberRefByName.get(col);
        if (vid == null) return null;
        const v = selections.numbers[vid];
        return v == null ? null : v;
      });
      if (vals.some((v) => v == null)) continue; // can't determine yet
      const numericVals = vals as number[];
      const extreme =
        side === "top" ? Math.max(...numericVals) : Math.min(...numericVals);
      const tiedCols = cols.filter((_, i) => numericVals[i] === extreme);
      if (tiedCols.length < 2) continue; // not tied
      const tiedLabels = tiedCols.map(
        (col) => (VARIABLE_LABELS as Record<string, string>)[col] ?? col
      );
      const refLabel =
        ref === "class_affinity" ? "Class Affinity" : "Nation Affinity";
      let resolved: Indicator["resolved"] = { kind: "unresolved" };
      const { kind: tbKind, invert } = TIEBREAK_KIND_BY_REF_SIDE[ref][side];
      const doc = tiebreakInputs?.get(tbKind);
      if (doc) {
        const docResult = evaluateDocument(doc);
        if (docResult.length === 1) {
          const r = docResult[0];
          if (r === RANDOM_RESULT_SENTINEL) {
            resolved = { kind: "random", pool: tiedLabels };
          } else {
            // Apply class-affinity invert (the bottom side aliases to
            // the top doc; flip to "the other one") when the resolved
            // option isn't already in the tied set.
            let winnerCol: string | null = r;
            if (invert && cols.length === 2 && tiedCols.length === 2) {
              winnerCol = cols.find((c) => c !== r) ?? null;
            }
            if (winnerCol && tiedCols.includes(winnerCol)) {
              resolved = {
                kind: "value",
                label:
                  (VARIABLE_LABELS as Record<string, string>)[winnerCol] ??
                  winnerCol,
              };
            }
          }
        }
      }
      out.push({ key, refLabel, side, tiedLabels, resolved });
    }
    return out;
  }, [chips, variables, numberRefByName, selections.numbers, tiebreakInputs]);
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

      {tieIndicators.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-blue-500/40 bg-blue-500/10 p-2 text-[11px] text-blue-200">
          <span className="font-mono uppercase tracking-widest text-[10px]">
            {tieIndicators.length} aggregate tie
            {tieIndicators.length === 1 ? "" : "s"} resolved by tiebreak
          </span>
          <ul className="flex flex-col gap-0.5 text-blue-100/85">
            {tieIndicators.map((t) => (
              <li key={t.key} className="font-mono">
                · {t.refLabel} ({t.side}) tied {t.tiedLabels.join(", ")} →{" "}
                {t.resolved.kind === "value" ? (
                  <span className="font-semibold">{t.resolved.label}</span>
                ) : t.resolved.kind === "random" ? (
                  <span className="inline-flex items-center gap-1 italic">
                    <Dice5 size={11} aria-hidden /> random of{" "}
                    {t.resolved.pool.join(", ")}
                  </span>
                ) : (
                  <span className="italic text-amber-200/90">
                    no rule (chip evaluates false)
                  </span>
                )}
              </li>
            ))}
          </ul>
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
