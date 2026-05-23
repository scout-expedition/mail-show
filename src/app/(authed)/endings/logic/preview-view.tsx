"use client";

import { useMemo, useState } from "react";
import { Blocks, Dice5, SquareStack } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD } from "@/components/panel";
import { IconDisplay } from "@/components/icon-display";
import { cn } from "@/lib/utils";
import { FlashRing } from "@/lib/realtime/flash-ring";
import {
  EMPTY_SELECTIONS,
  evaluateDocumentDetailed,
  resolveAggregatesDetailed,
  resolveSmartVariables,
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
import type {
  EndingDocument,
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
import {
  AGGREGATE_OPTIONS_BY_REF,
  ENDING_LOGIC_RESULT_OPTIONS_BY_KIND,
  isRandomSentinel,
  parseRandomSubset,
  RANDOM_ALL_SENTINEL,
  RANDOM_REMAINING_SENTINEL,
  RANDOM_RESULT_SENTINEL,
  RANDOM_TIED_SENTINEL,
  type EndingLogicKind,
} from "@/lib/db/enums";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";
import {
  VariableInput,
  bucketReferencedVariables,
  withZeroNumberDefaults,
  type PreviewCtx,
} from "../_preview/variable-input";
import { referencedVariableIdsForDoc } from "@/lib/endings/smart-variable-deps";

/**
 * Build the pool of options a random sentinel rolls over for a given
 * doc kind in the standalone preview. `tiedNations` is the user's
 * declared hypothetical tied set on nation_affinity_* tabs — used as
 * the pool for `__random_tied__`. Returns null when the sentinel
 * needs runtime context that the preview can't provide (e.g.
 * `__random_tied__` with fewer than two declared tied options).
 */
function rollPoolForSentinel(
  sentinel: string,
  docKind: EndingLogicKind,
  frameworks: EndingDocument[],
  tiedNations: string[]
): string[] | null {
  const subset = parseRandomSubset(sentinel);
  if (subset != null) return subset;
  if (sentinel === RANDOM_ALL_SENTINEL) {
    if (docKind === "framework_selection") {
      return frameworks
        .filter((f) => f.kind === "framework")
        .map((f) => f.id);
    }
    if (docKind === "class_affinity_top") {
      return [...AGGREGATE_OPTIONS_BY_REF.class_affinity];
    }
    if (
      docKind === "nation_affinity_top" ||
      docKind === "nation_affinity_bottom"
    ) {
      return [...AGGREGATE_OPTIONS_BY_REF.nation_affinity];
    }
    return null;
  }
  if (sentinel === RANDOM_RESULT_SENTINEL) {
    // Legacy alias maps to the kind's full option set when there's no
    // tied context — in the standalone preview we treat it as "any".
    const allowed = ENDING_LOGIC_RESULT_OPTIONS_BY_KIND[docKind];
    if (allowed) return [...allowed];
    return null;
  }
  if (sentinel === RANDOM_TIED_SENTINEL) {
    // Only nation tabs expose a tied-set picker; class affinity has
    // only 2 options so a "tied set" is degenerate (always both).
    if (
      (docKind === "nation_affinity_top" ||
        docKind === "nation_affinity_bottom") &&
      tiedNations.length >= 2
    ) {
      return [...tiedNations];
    }
    return null;
  }
  if (sentinel === RANDOM_REMAINING_SENTINEL) {
    // Only meaningful inside narrowing context, which the caller picks
    // up from `evaluateDocumentDetailed.rollPool`. This branch is the
    // non-narrowing fallback and has no pool to offer.
    return null;
  }
  return null;
}

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
  flashColors,
  frameworks,
  tiebreakDocs,
  nations,
  smartVariableDocs,
  smartVariableReturns,
  smartVariableEvalInputsByDocId,
  smartVarDocIdByVariableId,
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
  /** Transient peer-change highlights keyed by variable id. */
  flashColors: Record<string, string>;
  frameworks: EndingDocument[];
  tiebreakDocs: Map<EndingLogicKind, EvalInputs>;
  nations: Pick<
    Nation,
    "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
  >[];
  smartVariableDocs?: EndingDocument[];
  smartVariableReturns?: Map<string, string[]>;
  /** EvalInputs for each smart_variable doc, keyed by doc id. */
  smartVariableEvalInputsByDocId?: Map<string, EvalInputs>;
  /** Maps smart_ref variable id → smart_variable_doc_id. */
  smartVarDocIdByVariableId?: Map<string, string>;
}) {
  const numberRefByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of variables) {
      if (v.kind === "number_ref" && v.number_ref) m.set(v.number_ref, v.id);
    }
    return m;
  }, [variables]);

  // Smart Variables referenced by chips on this logic doc.
  const referencedSmartVars = useMemo(
    () =>
      referencedVariables.filter(
        (v) =>
          v.kind === "smart_ref" &&
          smartVarDocIdByVariableId?.has(v.id) === true
      ),
    [referencedVariables, smartVarDocIdByVariableId]
  );

  // Per-smart-var toggle: "set_result" | "set_inputs". Default: "set_inputs".
  const [svModes, setSvModes] = useState<Record<string, "set_result" | "set_inputs">>({});
  function svMode(variableId: string): "set_result" | "set_inputs" {
    return svModes[variableId] ?? "set_inputs";
  }
  function setSvMode(variableId: string, mode: "set_result" | "set_inputs") {
    setSvModes((prev) => ({ ...prev, [variableId]: mode }));
  }

  // Direct-result picks keyed by variableId → value string.
  const [svDirectResults, setSvDirectResults] = useState<Record<string, string>>({});
  function setSvDirectResult(variableId: string, value: string) {
    setSvDirectResults((prev) => ({ ...prev, [variableId]: value }));
  }

  // Build the resolved aggregates once from the parent doc's chips so
  // smart-var "set_inputs" evaluations share the same aggregate resolution.
  const evalVariables = useMemo(
    () =>
      variables.map(
        (v): EvalVariable => ({
          id: v.id,
          name: v.name,
          kind: v.kind,
          aggregate_ref: v.aggregate_ref,
        })
      ),
    [variables]
  );
  const variableIndex = useMemo(() => {
    const m = new Map<string, EvalVariable>();
    for (const v of evalVariables) m.set(v.id, v);
    return m;
  }, [evalVariables]);
  const baseSelections = useMemo<PreviewSelections>(
    () => ({
      ...(selections ?? EMPTY_SELECTIONS),
      numbers: withZeroNumberDefaults(
        selections?.numbers ?? {},
        referencedVariables
      ),
      numberRefByName,
      tiebreak_docs: tiebreakDocs,
    }),
    [selections, numberRefByName, tiebreakDocs, referencedVariables]
  );
  const resolvedAggregates = useMemo(() => {
    const detailed = resolveAggregatesDetailed(
      chips as EvalChip[],
      variableIndex,
      baseSelections
    );
    const m = new Map<string, string | null>();
    for (const [k, v] of detailed) m.set(k, v.value);
    return m;
  }, [chips, variableIndex, baseSelections]);

  // For each "set_inputs" smart var: build its EvalInputs, run the evaluator,
  // and collect into smartVariableResults. "set_result" vars use the direct
  // pick instead.
  const smartVariableResults = useMemo((): Record<string, string | null> => {
    const out: Record<string, string | null> = {};
    const setInputsBatch: Array<{ variable_id: string; inputs: EvalInputs }> = [];
    for (const sv of referencedSmartVars) {
      const mode = svModes[sv.id] ?? "set_inputs";
      if (mode === "set_result") {
        const picked = svDirectResults[sv.id] ?? null;
        out[sv.id] = picked !== "" ? picked : null;
      } else {
        const docId = smartVarDocIdByVariableId?.get(sv.id);
        if (!docId) { out[sv.id] = null; continue; }
        const baseInputs = smartVariableEvalInputsByDocId?.get(docId);
        if (!baseInputs) {
          out[sv.id] = null;
          continue;
        }
        setInputsBatch.push({
          variable_id: sv.id,
          inputs: {
            ...baseInputs,
            selections: {
              ...baseInputs.selections,
              ...baseSelections,
              resolved_aggregates: resolvedAggregates,
            },
          },
        });
      }
    }
    const resolved = resolveSmartVariables(setInputsBatch);
    for (const [vid, val] of resolved) {
      out[vid] = val;
    }
    return out;
  }, [
    referencedSmartVars,
    svModes,
    svDirectResults,
    smartVarDocIdByVariableId,
    smartVariableEvalInputsByDocId,
    baseSelections,
    resolvedAggregates,
  ]);

  // Variables available for "set_inputs" per smart var (keyed by variable id).
  const svInputVarsByVariableId = useMemo(() => {
    const m = new Map<string, VariableState[]>();
    for (const sv of referencedSmartVars) {
      const docId = smartVarDocIdByVariableId?.get(sv.id);
      if (!docId) { m.set(sv.id, []); continue; }
      const baseInputs = smartVariableEvalInputsByDocId?.get(docId);
      if (!baseInputs) { m.set(sv.id, []); continue; }
      const ids = referencedVariableIdsForDoc({
        blocks: baseInputs.blocks as BlockState[],
        chips: baseInputs.chips as ChipState[],
        variables: baseInputs.variables as unknown as VariableState[],
      });
      const eligible = variables.filter(
        (v) => ids.has(v.id) && v.kind !== "aggregate_ref" && v.kind !== "smart_ref"
      );
      m.set(sv.id, eligible);
    }
    return m;
  }, [referencedSmartVars, smartVarDocIdByVariableId, smartVariableEvalInputsByDocId, variables]);

  const nationByName = useMemo(() => {
    const m = new Map<
      string,
      Pick<Nation, "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value">
    >();
    for (const n of nations) m.set(n.name.toLowerCase(), n);
    return m;
  }, [nations]);

  // PreviewCtx for VariableInput — shares the same onChangeText/onChangeNumber
  // as the parent panel so smart-var inputs bind to the same selections slots.
  const variableById = useMemo(() => {
    const m = new Map<string, VariableState>();
    for (const v of variables) m.set(v.id, v);
    return m;
  }, [variables]);
  const previewCtx = useMemo<PreviewCtx>(
    () => ({
      variableById,
      declaredByBlock: new Map(),
      values,
      selections: selections ?? EMPTY_SELECTIONS,
      nationByName,
      flashColors,
      onChangeText,
      onChangeNumber,
    }),
    [variableById, values, selections, nationByName, flashColors, onChangeText, onChangeNumber]
  );

  // Hypothetical tied set on nation_affinity_* tabs. Drives both the
  // set-narrowing evaluator and the pool for terminal random sentinels.
  // Authors toggle pills (one per impact-column name) to declare which
  // nations are tied; the picker is hidden on other doc kinds.
  const isNationTab =
    docKind === "nation_affinity_top" || docKind === "nation_affinity_bottom";
  const [tiedNations, setTiedNations] = useState<string[]>([]);
  function toggleTiedNation(name: string) {
    setTiedNations((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  const evalInputs = useMemo<EvalInputs>(
    () => ({
      blocks: blocks as EvalBlock[],
      rows: rows as EvalRow[],
      chips: chips as EvalChip[],
      variables: evalVariables,
      selections: {
        ...baseSelections,
        resolved_aggregates: resolvedAggregates,
        smartVariableResults,
      },
    }),
    [blocks, rows, chips, evalVariables, baseSelections, resolvedAggregates, smartVariableResults]
  );

  const result = useMemo(() => {
    if (isNationTab && tiedNations.length > 0) {
      return evaluateDocumentDetailed(evalInputs, {
        initialTiebreakSet: tiedNations,
      });
    }
    return evaluateDocumentDetailed(evalInputs);
  }, [evalInputs, isNationTab, tiedNations]);
  const resolved = result.rollSentinel ?? result.paragraphs[0] ?? null;

  const frameworkNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of frameworks) {
      if (f.kind === "framework" && f.name) m.set(f.id, f.name);
    }
    return m;
  }, [frameworks]);

  // Random sentinels expand to a rolled value at preview time so the
  // author can see "what would actually happen". The roll runs inside
  // a useMemo keyed by `[poolSnapshot, rollNonce]` — pool change
  // (different sentinel, framework added/removed, subset edited, tied
  // set toggled) re-rolls, and the Dice button bumps the nonce to
  // force a fresh roll without any other input change.
  const rollPool = useMemo(() => {
    if (resolved == null || !isRandomSentinel(resolved)) return null;
    // The narrowing evaluator already returns the post-`__remove__:` working
    // set as `result.rollPool`; trust it for nation tiebreak random
    // sentinels. For other paths (non-narrowing) infer the pool from the
    // sentinel + preview context.
    if (result.rollPool && result.rollPool.length > 0) return result.rollPool;
    return rollPoolForSentinel(resolved, docKind, frameworks, tiedNations);
  }, [resolved, result.rollPool, docKind, frameworks, tiedNations]);
  const poolSnapshot = useMemo(
    () => (rollPool ? [...rollPool].sort().join("|") : null),
    [rollPool]
  );
  const [rollNonce, setRollNonce] = useState(0);
  const rolled = useMemo(() => {
    if (!rollPool || rollPool.length === 0) return null;

    // eslint-disable-next-line react-hooks/purity
    return rollPool[Math.floor(Math.random() * rollPool.length)];
    // poolSnapshot stands in for the pool's identity so rolls survive
    // unrelated re-renders; rollNonce is the manual reroll trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolSnapshot, rollNonce]);
  const rerollNow = () => setRollNonce((n) => n + 1);
  const rolledLabel = useMemo(() => {
    if (rolled == null) return null;
    if (docKind === "framework_selection") {
      return frameworkNameById.get(rolled) ?? `(unknown: ${rolled})`;
    }
    return (VARIABLE_LABELS as Record<string, string>)[rolled] ?? rolled;
  }, [rolled, docKind, frameworkNameById]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {referencedVariables.some(
        (v) => v.kind !== "aggregate_ref" && v.kind !== "smart_ref"
      ) ? (
        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Set variable values
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {referencedVariables
              .filter((v) => v.kind !== "aggregate_ref" && v.kind !== "smart_ref")
              .map((v) => (
                <div
                  key={v.id}
                  className="grid grid-cols-[1fr_1fr] items-center gap-2"
                >
                  <Label className="!text-xs">{v.name}</Label>
                  <FlashRing color={flashColors[v.id]}>
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
                  </FlashRing>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {referencedSmartVars.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Smart Variables
          </div>
          <div className="flex flex-col gap-3">
            {referencedSmartVars.map((sv) => {
              const docId = smartVarDocIdByVariableId?.get(sv.id);
              const doc = docId
                ? smartVariableDocs?.find((d) => d.id === docId)
                : undefined;
              const mode = svMode(sv.id);
              const resultOptions = smartVariableReturns?.get(sv.id) ?? [];
              const hasResults = resultOptions.length > 0;
              const inputVars = svInputVarsByVariableId.get(sv.id) ?? [];
              return (
                <div key={sv.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{doc?.name ?? sv.name}</span>
                    <div className="inline-flex overflow-hidden rounded-md border border-border/60">
                      <button
                        type="button"
                        aria-label="Set inputs"
                        title="Set inputs"
                        aria-pressed={mode === "set_inputs"}
                        onClick={() => setSvMode(sv.id, "set_inputs")}
                        className={cn(
                          "flex h-6 w-7 items-center justify-center transition-colors",
                          mode === "set_inputs"
                            ? "bg-muted/60 text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <SquareStack size={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label="Set result"
                        title="Set result"
                        aria-pressed={mode === "set_result"}
                        onClick={() => setSvMode(sv.id, "set_result")}
                        className={cn(
                          "flex h-6 w-7 items-center justify-center border-l border-border/60 transition-colors",
                          mode === "set_result"
                            ? "bg-muted/60 text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Blocks size={12} aria-hidden />
                      </button>
                    </div>
                  </div>
                  {mode === "set_result" ? (
                    <div>
                      <Select
                        aria-label={`${sv.name} result`}
                        value={svDirectResults[sv.id] ?? ""}
                        onChange={(e) => setSvDirectResult(sv.id, e.target.value)}
                        disabled={!hasResults}
                        className={cn("h-8 w-full", GHOST_FIELD)}
                      >
                        <option value="">—</option>
                        {resultOptions.map((val) => (
                          <option key={val} value={val}>
                            {val}
                          </option>
                        ))}
                      </Select>
                      {!hasResults ? (
                        <p className="mt-1 text-[11px] italic text-muted-foreground">
                          No result blocks defined on this smart variable.
                        </p>
                      ) : null}
                    </div>
                  ) : inputVars.length > 0 ? (
                    <SmartVarInputsPanel
                      inputs={inputVars}
                      ctx={previewCtx}
                    />
                  ) : (
                    <p className="text-[11px] italic text-muted-foreground">
                      No settable inputs for this smart variable.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {isNationTab ? (
        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Hypothetical tied set
          </div>
          <div className="flex flex-wrap gap-1.5">
            {AGGREGATE_OPTIONS_BY_REF.nation_affinity.map((col) => {
              // Match the impact-column name to a Nation row by display
              // name (column "folos" ↔ Nation "Folos"). The Nation
              // supplies the color + icon; the column name is what the
              // evaluator works against.
              const display =
                (VARIABLE_LABELS as Record<string, string>)[col] ?? col;
              const nation = nations.find((n) => n.name === display);
              const on = tiedNations.includes(col);
              const color = nation?.color_hex;
              return (
                <button
                  key={col}
                  type="button"
                  onClick={() => toggleTiedNation(col)}
                  aria-pressed={on}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
                    on
                      ? "border-foreground/40 bg-foreground/10 text-foreground"
                      : "border-border/40 bg-transparent text-muted-foreground/70 hover:text-foreground"
                  )}
                  style={on && color ? { borderColor: color } : undefined}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center transition-opacity",
                      on ? "opacity-100" : "opacity-40"
                    )}
                    style={color ? { color } : undefined}
                  >
                    {nation?.icon_value ? (
                      <IconDisplay
                        type={nation.icon_type}
                        value={nation.icon_value}
                        size={12}
                      />
                    ) : (
                      <span className="text-[10px] font-mono">
                        {nation?.abbreviation ?? display.slice(0, 1)}
                      </span>
                    )}
                  </span>
                  <span>{display}</span>
                </button>
              );
            })}
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
        ) : isRandomSentinel(resolved) ? (
          rollPool && rolledLabel ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={rerollNow}
                  aria-label="Re-roll random result"
                  title="Re-roll random result"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <Dice5 size={12} aria-hidden />
                </button>
                <span className="font-semibold">{rolledLabel}</span>
              </div>
              <span className="text-[11px] italic text-muted-foreground">
                {(() => {
                  const subset = parseRandomSubset(resolved);
                  if (subset) {
                    const names = subset
                      .map((id) => frameworkNameById.get(id) ?? "(deleted)")
                      .join(", ");
                    return `random — rolled from ${subset.length}: ${names}`;
                  }
                  const labels = rollPool.map((opt) => {
                    if (docKind === "framework_selection") {
                      return frameworkNameById.get(opt) ?? "(deleted)";
                    }
                    return (
                      (VARIABLE_LABELS as Record<string, string>)[opt] ?? opt
                    );
                  });
                  return `random — rolled from ${rollPool.length} option${rollPool.length === 1 ? "" : "s"} (${labels.join(", ")})`;
                })()}
              </span>
            </div>
          ) : (
            <p>
              <span className="italic text-muted-foreground">
                (random — picked at runtime
                {resolved === RANDOM_TIED_SENTINEL
                  ? "; preview can't roll without a tied set"
                  : ""}
                )
              </span>
            </p>
          )
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

function SmartVarInputsPanel({
  inputs,
  ctx,
}: {
  inputs: VariableState[];
  ctx: PreviewCtx;
}) {
  const buckets = bucketReferencedVariables(inputs);
  const hasAnyImpacts =
    buckets.classImpacts.length > 0 ||
    buckets.nationImpacts.length > 0 ||
    buckets.worldImpacts.length > 0;
  return (
    <div className="flex flex-col gap-1.5 border-l border-border/40 pl-2">
      {buckets.text.length > 0 ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {buckets.text.map((v) => (
            <VariableInput key={v.id} variable={v} ctx={ctx} />
          ))}
        </div>
      ) : null}
      {hasAnyImpacts ? (
        <div className="flex flex-wrap items-start gap-1.5">
          {buckets.classImpacts.length > 0 ? (
            <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
              {buckets.classImpacts.map((v) => (
                <VariableInput key={v.id} variable={v} ctx={ctx} />
              ))}
            </div>
          ) : null}
          {buckets.nationImpacts.length > 0 ? (
            <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
              {buckets.nationImpacts.map((v) => (
                <VariableInput key={v.id} variable={v} ctx={ctx} />
              ))}
            </div>
          ) : null}
          {buckets.worldImpacts.length > 0 ? (
            <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
              {buckets.worldImpacts.map((v) => (
                <VariableInput key={v.id} variable={v} ctx={ctx} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {buckets.otherNumbers.length > 0 ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {buckets.otherNumbers.map((v) => (
            <VariableInput key={v.id} variable={v} ctx={ctx} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
