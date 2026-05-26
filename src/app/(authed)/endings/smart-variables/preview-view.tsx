"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Dice5 } from "lucide-react";
import {
  EMPTY_SELECTIONS,
  aggregateKey,
  evaluateDocumentDetailed,
  evaluateRow,
  resolveAggregatesDetailed,
  type EvalBlock,
  type EvalChip,
  type EvalInputs,
  type EvalRow,
  type EvalVariable,
  type PreviewItem,
  type PreviewSelections,
} from "@/lib/endings/evaluator";
import type {
  BlockState,
  BlockVariableState,
  ChipState,
  RowState,
  VariableState,
} from "@/lib/endings/block-state";
import type { EndingVariableValue, Nation } from "@/lib/db/types";
import {
  AGGREGATE_OPTIONS_BY_REF,
  type AggregateRef,
  type EndingLogicKind,
} from "@/lib/db/enums";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";
import {
  ReferencedVariablesPanel,
  withZeroNumberDefaults,
  type PreviewCtx,
} from "../_preview/variable-input";

export function SmartVariablePreviewView({
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
  tiebreakInputs,
  nations,
}: {
  name: string;
  blocks: BlockState[];
  rows: RowState[];
  chips: ChipState[];
  blockVariables: BlockVariableState[];
  variables: VariableState[];
  referencedVariables: VariableState[];
  values: EndingVariableValue[];
  selections: PreviewSelections;
  onChangeText: (variableId: string, valueId: string | null) => void;
  onChangeNumber: (variableId: string, value: number | null) => void;
  flashColors: Record<string, string>;
  tiebreakInputs?: Map<EndingLogicKind, EvalInputs>;
  nations?: Pick<
    Nation,
    "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
  >[];
}) {
  const numberRefByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of variables) {
      if (v.kind === "number_ref" && v.number_ref) {
        m.set(v.number_ref, v.id);
      }
    }
    return m;
  }, [variables]);

  const evalChips = useMemo(() => chips as EvalChip[], [chips]);
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
      tiebreak_docs: tiebreakInputs,
    }),
    [selections, numberRefByName, tiebreakInputs, referencedVariables]
  );

  // Per-key roll cache — mirrors frameworks/preview-view.tsx exactly.
  const [rollCache, setRollCache] = useState<
    Map<string, { value: string; poolSnapshot: string }>
  >(new Map());

  const detailedResolution = useMemo(() => {
    const fresh = resolveAggregatesDetailed(
      evalChips,
      variableIndex,
      baseSelections
    );
    const out: typeof fresh = new Map();
    for (const [key, res] of fresh) {
      if (!res.fromRandom || !res.rollPool) {
        out.set(key, res);
        continue;
      }
      const poolSnapshot = [...res.rollPool].sort().join("|");
      const cached = rollCache.get(key);
      if (
        cached &&
        cached.poolSnapshot === poolSnapshot &&
        res.rollPool.includes(cached.value)
      ) {
        out.set(key, {
          value: cached.value,
          fromRandom: true,
          rollPool: res.rollPool,
        });
      } else {
        out.set(key, res);
      }
    }
    return out;
  }, [evalChips, variableIndex, baseSelections, rollCache]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRollCache((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const [key, res] of detailedResolution) {
        if (!res.fromRandom || !res.value || !res.rollPool) continue;
        const poolSnapshot = [...res.rollPool].sort().join("|");
        const existing = prev.get(key);
        if (
          !existing ||
          existing.value !== res.value ||
          existing.poolSnapshot !== poolSnapshot
        ) {
          next.set(key, { value: res.value, poolSnapshot });
          changed = true;
        }
      }
      for (const key of prev.keys()) {
        if (!detailedResolution.has(key)) {
          next.delete(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [detailedResolution]);

  const rerollKey = useCallback((key: string) => {
    setRollCache((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const resolvedAggregates = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const [k, v] of detailedResolution) m.set(k, v.value);
    return m;
  }, [detailedResolution]);

  const evalInputs = useMemo(
    () => ({
      blocks: blocks as EvalBlock[],
      rows: rows as EvalRow[],
      chips: evalChips,
      variables: evalVariables,
      values,
      selections: {
        ...baseSelections,
        resolved_aggregates: resolvedAggregates,
      },
    }),
    [blocks, rows, evalChips, evalVariables, values, baseSelections, resolvedAggregates]
  );

  const evaluation = useMemo(
    () => evaluateDocumentDetailed(evalInputs, { trackPending: true }),
    [evalInputs]
  );

  // For smart variables: extract scalar result_value from first paragraph.
  // Determine whether it came from fallback (no condition fired).
  const resultValue = evaluation.paragraphs[0] ?? null;
  const fromFallback = useMemo(() => {
    // previewItems populated with trackPending: true. If every item has
    // blockId starting with the fallback block or no condition item is
    // present and there's a result, we're in fallback territory.
    // Simpler: check if previewItems contains only a single "text" item
    // AND the result came from a root-level fallback block.
    const items = evaluation.previewItems ?? [];
    if (resultValue == null) return false;
    // Condition or text blocks fire as "condition"/"text" items. If the
    // only item is a text item whose blockId matches a fallback block, we're
    // from fallback. Check blocks directly.
    const fallbackBlock = (blocks as EvalBlock[]).find(
      (b) => b.block_type === "fallback" && b.parent_block_id == null && b.parent_row_id == null
    );
    if (!fallbackBlock) return false;
    if (items.length === 1 && items[0].kind === "text" && items[0].blockId === fallbackBlock.id) {
      return true;
    }
    return false;
  }, [evaluation.previewItems, resultValue, blocks]);

  // Nested matched-condition path — every fired condition block from the
  // root down to the result, with the chip summary of the row that fired
  // inside each one. Built by recursively walking the evaluator's
  // previewItems tree; the matched row id is recovered by re-running
  // `evaluateRow` against the same selections.
  const matchedConditionPath = useMemo<MatchedNode[]>(() => {
    if (fromFallback || resultValue == null) return [];
    return walkMatchedConditions(
      evaluation.previewItems ?? [],
      rows,
      chips,
      variables,
      values,
      variableIndex,
      evalInputs.selections
    );
  }, [
    evaluation.previewItems,
    fromFallback,
    resultValue,
    rows,
    chips,
    variables,
    values,
    variableIndex,
    evalInputs.selections,
  ]);

  // Aggregate tie indicators (mirrors frameworks/preview-view.tsx).
  const tieIndicators = useMemo(() => {
    type Indicator = {
      key: string;
      refLabel: string;
      side: "top" | "bottom";
      tiedLabels: string[];
      fromRandom: boolean;
      resolved: { kind: "value"; label: string } | { kind: "unresolved" };
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
      const key = aggregateKey(ref, side);
      if (seen.has(key)) continue;
      seen.add(key);
      const cols = AGGREGATE_OPTIONS_BY_REF[ref];
      const vals: (number | null)[] = cols.map((col) => {
        const vid = numberRefByName.get(col);
        if (vid == null) return null;
        const v = baseSelections.numbers[vid];
        return v == null ? null : v;
      });
      if (vals.some((v) => v == null)) continue;
      const numericVals = vals as number[];
      const extreme =
        side === "top" ? Math.max(...numericVals) : Math.min(...numericVals);
      const tiedCols = cols.filter((_, i) => numericVals[i] === extreme);
      if (tiedCols.length < 2) continue;
      const tiedLabels = tiedCols.map(
        (col) => (VARIABLE_LABELS as Record<string, string>)[col] ?? col
      );
      const refLabel =
        ref === "class_affinity" ? "Class Affinity" : "Nation Affinity";
      const detail = detailedResolution.get(key);
      const resolvedCol = detail?.value ?? null;
      const resolved: Indicator["resolved"] =
        resolvedCol && tiedCols.includes(resolvedCol)
          ? {
              kind: "value",
              label:
                (VARIABLE_LABELS as Record<string, string>)[resolvedCol] ??
                resolvedCol,
            }
          : { kind: "unresolved" };
      out.push({
        key,
        refLabel,
        side,
        tiedLabels,
        fromRandom: detail?.fromRandom ?? false,
        resolved,
      });
    }
    return out;
  }, [chips, variables, numberRefByName, baseSelections.numbers, detailedResolution]);

  const nationByName = useMemo(() => {
    const m = new Map<
      string,
      Pick<
        Nation,
        "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
      >
    >();
    for (const n of nations ?? []) m.set(n.name.toLowerCase(), n);
    return m;
  }, [nations]);

  const variableStateById = useMemo(() => {
    const m = new Map<string, VariableState>();
    for (const v of variables) m.set(v.id, v);
    return m;
  }, [variables]);

  const declaredByBlock = useMemo(
    () => new Map<string, VariableState[]>(),
    []
  );

  const previewCtx = useMemo<PreviewCtx>(
    () => ({
      variableById: variableStateById,
      declaredByBlock,
      values,
      selections,
      nationByName,
      flashColors,
      onChangeText,
      onChangeNumber,
    }),
    [
      variableStateById,
      declaredByBlock,
      values,
      selections,
      nationByName,
      flashColors,
      onChangeText,
      onChangeNumber,
    ]
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <ReferencedVariablesPanel
        referencedVariables={referencedVariables}
        ctx={previewCtx}
        unresolvedVariableNames={new Set()}
      />

      {tieIndicators.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-blue-500/40 bg-blue-500/10 p-2 text-[11px] text-blue-200">
          <span className="font-mono uppercase tracking-widest text-[10px]">
            {tieIndicators.length} aggregate tie
            {tieIndicators.length === 1 ? "" : "s"} resolved by tiebreak
          </span>
          <ul className="flex flex-col gap-0.5 text-blue-100/85">
            {tieIndicators.map((t) => (
              <li key={t.key} className="flex items-center gap-1 font-mono">
                <span>
                  · {t.refLabel} ({t.side}) tied {t.tiedLabels.join(", ")} →
                </span>
                {t.fromRandom ? (
                  <button
                    type="button"
                    onClick={() => rerollKey(t.key)}
                    aria-label="Reroll random tiebreak"
                    title="Reroll"
                    className="inline-flex h-4 w-4 items-center justify-center rounded text-blue-100/80 transition-colors hover:bg-blue-500/25 hover:text-blue-50"
                  >
                    <Dice5 size={12} aria-hidden />
                  </button>
                ) : null}
                {t.resolved.kind === "value" ? (
                  <span className="font-semibold">{t.resolved.label}</span>
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

      {matchedConditionPath.length > 0 ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/10 p-2 text-[11px] text-muted-foreground">
          <span className="font-mono uppercase tracking-widest text-[10px]">
            Matched conditions
          </span>
          <MatchedConditionList nodes={matchedConditionPath} />
        </div>
      ) : null}

      <article className="flex flex-col gap-2 text-sm leading-relaxed text-foreground">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Resolves to
          {fromFallback ? (
            <span className="ml-1 font-normal normal-case text-muted-foreground/70">
              (from fallback)
            </span>
          ) : resultValue == null ? (
            <span className="ml-1 font-normal normal-case text-muted-foreground/70">
              (no match)
            </span>
          ) : null}
        </h3>
        {resultValue == null || resultValue === "" ? (
          <p className="italic text-muted-foreground/80">
            (no condition matched and no fallback set)
          </p>
        ) : (
          <p className="font-semibold">{resultValue}</p>
        )}
      </article>
    </div>
  );
}

interface MatchedNode {
  blockId: string;
  blockSummary: string | null;
  rowSummary: string | null;
  children: MatchedNode[];
}

function walkMatchedConditions(
  items: ReadonlyArray<PreviewItem>,
  rows: ReadonlyArray<RowState>,
  chips: ReadonlyArray<ChipState>,
  variables: ReadonlyArray<VariableState>,
  values: ReadonlyArray<EndingVariableValue>,
  variableIndex: Map<string, EvalVariable>,
  selections: PreviewSelections
): MatchedNode[] {
  const out: MatchedNode[] = [];
  for (const item of items) {
    if (item.kind !== "condition") continue;
    const blockRows = rows
      .filter((r) => r.condition_block_id === item.blockId)
      .sort((a, b) => a.sort_order - b.sort_order);
    let rowSummary: string | null = null;
    for (const r of blockRows) {
      const rowChips = chips.filter((c) => c.row_id === r.id);
      if (rowChips.length === 0) continue;
      if (evaluateRow(rowChips as EvalChip[], variableIndex, selections)) {
        rowSummary = chipSummary(rowChips, variables, values);
        break;
      }
    }
    out.push({
      blockId: item.blockId,
      blockSummary: item.summary,
      rowSummary,
      children: walkMatchedConditions(
        item.children,
        rows,
        chips,
        variables,
        values,
        variableIndex,
        selections
      ),
    });
  }
  return out;
}

function MatchedConditionList({ nodes }: { nodes: MatchedNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {nodes.map((n) => (
        <li key={n.blockId} className="flex flex-col gap-0.5">
          {n.blockSummary || n.rowSummary ? (
            <span className="font-mono">
              {n.blockSummary ? (
                <span className="text-muted-foreground/85">
                  {n.blockSummary}
                </span>
              ) : null}
              {n.blockSummary && n.rowSummary ? (
                <span className="px-1 text-muted-foreground/50">›</span>
              ) : null}
              {n.rowSummary ? (
                <span className="text-foreground/90">{n.rowSummary}</span>
              ) : null}
            </span>
          ) : null}
          {n.children.length > 0 ? (
            <div className="ml-3 border-l border-border/50 pl-2">
              <MatchedConditionList nodes={n.children} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function chipSummary(
  chips: ReadonlyArray<ChipState>,
  variables: ReadonlyArray<VariableState>,
  values: ReadonlyArray<EndingVariableValue>
): string {
  if (chips.length === 0) return "";
  const sorted = [...chips].sort((a, b) => a.sort_order - b.sort_order);
  const varById = new Map(variables.map((v) => [v.id, v]));
  const valueById = new Map(values.map((v) => [v.id, v]));
  const labelFor = (col: string) =>
    (VARIABLE_LABELS as Record<string, string>)[col] ?? col;
  return sorted
    .map((chip) => {
      const variable = varById.get(chip.variable_id);
      if (!variable) return "?";
      let value: string;
      switch (variable.kind) {
        case "text":
          value = valueById.get(chip.text_value_id ?? "")?.value ?? "—";
          break;
        case "number_ref":
          value =
            chip.number_value == null ? "—" : String(chip.number_value);
          break;
        case "aggregate_ref":
          value =
            chip.aggregate_value == null ? "—" : labelFor(chip.aggregate_value);
          break;
        case "smart_ref":
          value = chip.aggregate_value ?? "—";
          break;
      }
      return `${variable.name} ${chip.operator} ${value}`;
    })
    .join(" & ");
}
