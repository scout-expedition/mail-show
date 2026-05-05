"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import {
  EMPTY_SELECTIONS,
  evaluateDocument,
  type EvalBlock,
  type EvalChip,
  type EvalRow,
  type EvalVariable,
  type EvalInputs,
  type PreviewSelections,
} from "@/lib/endings/evaluator";
import type {
  BlockState,
  ChipState,
  RowState,
  VariableState,
} from "@/lib/endings/block-state";
import type { EndingDocument, EndingVariableValue } from "@/lib/db/types";
import type { EndingLogicKind } from "@/lib/db/enums";
import { RANDOM_RESULT_SENTINEL } from "@/lib/db/enums";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";

/**
 * Preview pane for the Ending Framework (and the affinity tiebreak)
 * tabs on the Logic page. Mirrors the framework preview's variable
 * inputs but renders the resolved result as a single line ("Resolves
 * to: <name>") rather than a paragraph stream.
 *
 * For framework_selection, the result is a framework document_id —
 * looked up against `frameworks` to display the framework name. For
 * affinity kinds the result is a class/nation column name. Empty
 * result string is rendered as `(no match)`.
 *
 * `tiebreakDocs` is a map of saved-state EvalInputs for each logic
 * kind so aggregate chips on the doc can resolve ties through the
 * tiebreak rules. The map reflects last-saved state of every logic
 * doc — unsaved edits to a tiebreak doc don't show up here until
 * saved.
 */
export function LogicPreviewView({
  docKind,
  blocks,
  rows,
  chips,
  variables,
  referencedVariables,
  values,
  selections,
  onChangeText,
  onChangeNumber,
  frameworks,
  tiebreakDocs,
}: {
  docKind: EndingLogicKind;
  blocks: BlockState[];
  rows: RowState[];
  chips: ChipState[];
  variables: VariableState[];
  referencedVariables: VariableState[];
  values: EndingVariableValue[];
  selections: PreviewSelections;
  onChangeText: (variableId: string, valueId: string | null) => void;
  onChangeNumber: (variableId: string, value: number | null) => void;
  frameworks: EndingDocument[];
  tiebreakDocs: Map<EndingLogicKind, EvalInputs>;
}) {
  const numberRefByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of variables) {
      if (v.kind === "number_ref" && v.number_ref) m.set(v.number_ref, v.id);
    }
    return m;
  }, [variables]);

  const evalInputs = useMemo<EvalInputs>(
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
        tiebreak_docs: tiebreakDocs,
      },
    }),
    [blocks, rows, chips, variables, selections, numberRefByName, tiebreakDocs]
  );

  const result = useMemo(() => evaluateDocument(evalInputs), [evalInputs]);
  const resolved = result[0] ?? null;

  const frameworkNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of frameworks) {
      if (f.kind === "framework" && f.name) m.set(f.id, f.name);
    }
    return m;
  }, [frameworks]);

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

      <article className="flex flex-col gap-2 text-sm leading-relaxed text-foreground">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Resolves to
        </h3>
        {resolved == null || resolved === "" ? (
          <p className="italic text-muted-foreground/80">
            (no match — the document didn&apos;t produce a result for these
            inputs)
          </p>
        ) : resolved === RANDOM_RESULT_SENTINEL ? (
          <p>
            <span className="italic text-muted-foreground">
              (random — picked at runtime)
            </span>
          </p>
        ) : docKind === "framework_selection" ? (
          <p>
            <span className="font-semibold">
              {frameworkNameById.get(resolved) ?? `(unknown framework: ${resolved})`}
            </span>
          </p>
        ) : (
          <p>
            <span className="font-semibold">
              {(VARIABLE_LABELS as Record<string, string>)[resolved] ?? resolved}
            </span>
          </p>
        )}
      </article>
    </div>
  );
}
