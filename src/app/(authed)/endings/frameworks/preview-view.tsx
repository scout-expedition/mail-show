"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { AlertTriangle, Dice5 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import {
  EMPTY_SELECTIONS,
  aggregateKey,
  evaluateDocumentDetailed,
  resolveAggregatesDetailed,
  shadowedRowIds,
  type EvalBlock,
  type EvalChip,
  type EvalInputs,
  type EvalRow,
  type EvalVariable,
  type PreviewSelections,
} from "@/lib/endings/evaluator";
import type { SubstitutionSegment } from "@/lib/endings/text-substitution";
import type {
  BlockState,
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
  ImpactTile,
  NationImpactTile,
  IMPACT_TILE_PRESETS,
} from "@/components/impact-tile";

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
  nations,
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
  nations?: Pick<
    Nation,
    "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
  >[];
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

  // Tiebreaks resolve once per evaluation pass, before any chip eval.
  // resolveAggregates rolls random sentinels exactly once here, so
  // every chip on the same (ref, side) sees the same winner — no more
  // "two `top= proletariat` chips disagree because the random rolled
  // differently per chip."
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
      numberRefByName,
      tiebreak_docs: tiebreakInputs,
    }),
    [selections, numberRefByName, tiebreakInputs]
  );
  // Surgical per-key reroll. `rollCache` keyed by aggregateKey caches
  // the value the random sentinel rolled, alongside a snapshot of the
  // pool it was picked from. We reuse the cached value while the pool
  // is unchanged — clicking a specific die clears just that key,
  // forcing it to re-roll on the next memo run; other keys keep their
  // cached values regardless of how many other keys exist.
  const [rollCache, setRollCache] = useState<
    Map<string, { value: string; poolSnapshot: string }>
  >(new Map());
  // Compute the resolution inline (not in a separate memo) so a cache
  // change actually triggers a fresh Math.random roll for the cleared
  // key. Memoizing the "fresh" pass separately would only roll once
  // on first render — clearing the cache for K would then fall through
  // to the same already-memoized value and the click would do nothing.
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
  // Sync newly-rolled values back into the cache so a subsequent
  // re-render with no input change keeps the same value (instead of
  // rolling fresh every render).
  useEffect(() => {
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
      // Drop any cache entries whose key is no longer present in the
      // resolution (e.g. the chip was deleted). Keeps the cache from
      // growing forever.
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
    [
      blocks,
      rows,
      evalChips,
      evalVariables,
      values,
      baseSelections,
      resolvedAggregates,
    ]
  );
  const evaluation = useMemo(
    () => evaluateDocumentDetailed(evalInputs),
    [evalInputs]
  );
  const paragraphs = evaluation.paragraphs;
  const paragraphSegments = evaluation.paragraphSegments;

  // Names of variables that authored `@[Name]` tokens in the body but
  // didn't resolve to a value (unknown name, unset selection, or
  // unresolved aggregate). The right-side input list yellows their
  // labels so authors can spot what still needs a value.
  const unresolvedVariableNames = useMemo(() => {
    const out = new Set<string>();
    for (const segs of paragraphSegments) {
      for (const seg of segs) {
        if (seg.kind === "unresolved") out.add(seg.variableName);
      }
    }
    return out;
  }, [paragraphSegments]);

  // Aggregate ties surfaced on the framework's referenced chips. The
  // resolution itself happens in `resolveAggregates` above (rolls
  // random once); this just picks up the results to render.
  const tieIndicators = useMemo(() => {
    type Indicator = {
      key: string;
      refLabel: string;
      side: "top" | "bottom";
      tiedLabels: string[];
      fromRandom: boolean;
      resolved:
        | { kind: "value"; label: string }
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
      const key = aggregateKey(ref, side);
      if (seen.has(key)) continue;
      seen.add(key);
      const cols = AGGREGATE_OPTIONS_BY_REF[ref];
      const vals: (number | null)[] = cols.map((col) => {
        const vid = numberRefByName.get(col);
        if (vid == null) return null;
        const v = selections.numbers[vid];
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
  }, [chips, variables, numberRefByName, selections.numbers, detailedResolution]);
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

  // Split the referenced number_ref variables into the same buckets the
  // actions page renders: class affinities, nation impacts, and the
  // demerits/world_status pair. Other number_ref variables (custom or
  // unfamiliar columns) fall through to a generic numeric input.
  const NATION_IMPACT_COLS = useMemo(
    () => new Set(["folos", "emberlyn", "spokgrad", "pelico", "epicenter"]),
    []
  );
  const CLASS_IMPACT_COLS = useMemo(
    () => new Set(["proletariat", "gentry"]),
    []
  );
  const WORLD_IMPACT_COLS = useMemo(
    () => new Set(["world_status", "demerits"]),
    []
  );
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

  const buckets = useMemo(() => {
    const text: VariableState[] = [];
    const classImpacts: VariableState[] = [];
    const nationImpacts: VariableState[] = [];
    const worldImpacts: VariableState[] = [];
    const otherNumbers: VariableState[] = [];
    for (const v of referencedVariables) {
      if (v.kind === "text") {
        text.push(v);
      } else if (v.kind === "number_ref" && v.number_ref) {
        if (CLASS_IMPACT_COLS.has(v.number_ref)) classImpacts.push(v);
        else if (NATION_IMPACT_COLS.has(v.number_ref)) nationImpacts.push(v);
        else if (WORLD_IMPACT_COLS.has(v.number_ref)) worldImpacts.push(v);
        else otherNumbers.push(v);
      }
      // aggregate_ref variables get filled out via their underlying
      // number_ref entries (resolved into the buckets above), not as
      // their own input.
    }
    return { text, classImpacts, nationImpacts, worldImpacts, otherNumbers };
  }, [
    referencedVariables,
    CLASS_IMPACT_COLS,
    NATION_IMPACT_COLS,
    WORLD_IMPACT_COLS,
  ]);

  const numericValue = (v: VariableState): number =>
    selections.numbers[v.id] == null ? 0 : (selections.numbers[v.id] as number);
  const setNumeric = (v: VariableState, n: number) => {
    onChangeNumber(v.id, n === 0 ? null : n);
  };
  const presetFor = (v: VariableState) =>
    v.number_ref ? IMPACT_TILE_PRESETS[v.number_ref] : undefined;

  const hasAnyImpacts =
    buckets.classImpacts.length > 0 ||
    buckets.nationImpacts.length > 0 ||
    buckets.worldImpacts.length > 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      {referencedVariables.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Set variable values
          </div>

          {buckets.text.length > 0 ? (
            <div className="mb-2 grid gap-2 sm:grid-cols-2">
              {buckets.text.map((v) => {
                const isUnresolved = unresolvedVariableNames.has(v.name);
                return (
                  <div
                    key={v.id}
                    className="grid grid-cols-[1fr_1fr] items-center gap-2"
                  >
                    <Label
                      className={cn(
                        "!text-xs",
                        isUnresolved && "text-amber-300"
                      )}
                    >
                      {v.name}
                    </Label>
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
                  </div>
                );
              })}
            </div>
          ) : null}

          {hasAnyImpacts ? (
            <div className="flex flex-wrap items-start gap-1.5">
              {buckets.classImpacts.length > 0 ? (
                <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
                  {buckets.classImpacts.map((v) => {
                    const preset = presetFor(v);
                    return (
                      <ImpactTile
                        key={v.id}
                        label={preset?.label ?? v.name}
                        icon={preset?.icon}
                        value={numericValue(v)}
                        onChange={(n) => setNumeric(v, n)}
                      />
                    );
                  })}
                </div>
              ) : null}

              {buckets.nationImpacts.length > 0 ? (
                <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
                  {buckets.nationImpacts.map((v) => {
                    const nation = v.number_ref
                      ? nationByName.get(v.number_ref)
                      : undefined;
                    if (!nation) {
                      const preset = presetFor(v);
                      return (
                        <ImpactTile
                          key={v.id}
                          label={preset?.label ?? v.name}
                          icon={preset?.icon}
                          value={numericValue(v)}
                          onChange={(n) => setNumeric(v, n)}
                        />
                      );
                    }
                    return (
                      <NationImpactTile
                        key={v.id}
                        nation={nation}
                        value={numericValue(v)}
                        onChange={(n) => setNumeric(v, n)}
                      />
                    );
                  })}
                </div>
              ) : null}

              {buckets.worldImpacts.length > 0 ? (
                <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
                  {buckets.worldImpacts.map((v) => {
                    const preset = presetFor(v);
                    return (
                      <ImpactTile
                        key={v.id}
                        label={preset?.label ?? v.name}
                        icon={preset?.icon}
                        value={numericValue(v)}
                        onChange={(n) => setNumeric(v, n)}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {buckets.otherNumbers.length > 0 ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {buckets.otherNumbers.map((v) => (
                <div
                  key={v.id}
                  className="grid grid-cols-[1fr_1fr] items-center gap-2"
                >
                  <Label className="!text-xs">{v.name}</Label>
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
                </div>
              ))}
            </div>
          ) : null}
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
          paragraphSegments.map((segments, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {segments.map((seg, j) => (
                <PreviewSegment key={j} segment={seg} />
              ))}
            </p>
          ))
        )}
      </article>
    </div>
  );
}

function PreviewSegment({ segment }: { segment: SubstitutionSegment }) {
  if (segment.kind === "value") {
    // Resolved variable value — render in the primary blue accent so
    // authors can see where substitution occurred at a glance.
    return <span className="text-[var(--primary)]">{segment.text}</span>;
  }
  if (segment.kind === "unresolved") {
    // Literal `@[Name]` token that didn't resolve (unknown name, unset
    // value, or unresolved aggregate). Yellow warning chrome matches
    // the unset-input label in the right-hand panel.
    return (
      <span className="text-amber-300" title="Variable not set">
        {segment.text}
      </span>
    );
  }
  return <>{segment.text}</>;
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
