"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { AlertTriangle, Blocks, Dice5, SquareStack } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import { FlashRing } from "@/lib/realtime/flash-ring";
import {
  EMPTY_SELECTIONS,
  aggregateKey,
  evaluateDocumentDetailed,
  resolveAggregatesDetailed,
  resolveSmartVariables,
  shadowedRowIds,
  type EvalBlock,
  type EvalChip,
  type EvalInputs,
  type EvalRow,
  type EvalVariable,
  type PreviewItem,
  type PreviewSelections,
} from "@/lib/endings/evaluator";
import type { SubstitutionSegment } from "@/lib/endings/text-substitution";
import type {
  BlockState,
  BlockVariableState,
  ChipState,
  RowState,
  VariableState,
} from "@/lib/endings/block-state";
import { VariableChip } from "../_blocks/chip";
import type {
  EndingBlock,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingDocument,
  EndingVariableValue,
  Nation,
} from "@/lib/db/types";
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
import { referencedVariableIdsForDoc } from "@/lib/endings/smart-variable-deps";
import { withZeroNumberDefaults } from "../_preview/variable-input";
import { buildSmartReturnsByVariable } from "@/lib/endings/smart-variable-returns";
import { paletteColor } from "@/lib/endings/color-palette";

// Impact-column buckets — shared by the top "Set variable values" panel
// and the in-preview pending-block pickers.
const NATION_IMPACT_COLS = new Set([
  "folos",
  "emberlyn",
  "spokgrad",
  "pelico",
  "epicenter",
]);
const CLASS_IMPACT_COLS = new Set(["proletariat", "gentry"]);
const WORLD_IMPACT_COLS = new Set(["world_status", "demerits"]);

type NationLite = Pick<
  Nation,
  "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
>;

function presetFor(v: VariableState) {
  return v.number_ref ? IMPACT_TILE_PRESETS[v.number_ref] : undefined;
}

export function PreviewView({
  name,
  blocks,
  rows,
  chips,
  blockVariables,
  variables,
  referencedVariables,
  values,
  selections,
  onChangeText,
  onChangeNumber,
  flashColors,
  tiebreakInputs,
  nations,
  smartVariableDocs,
  smartVariableAllBlocks,
  smartVariableRows,
  smartVariableChips,
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
  /** Transient peer-change highlights keyed by variable id. */
  flashColors: Record<string, string>;
  tiebreakInputs?: Map<EndingLogicKind, EvalInputs>;
  nations?: Pick<
    Nation,
    "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
  >[];
  /** Smart variable docs — used to resolve smart_ref variables in the preview. */
  smartVariableDocs?: EndingDocument[];
  /** ALL blocks for smart variable docs (all block_types). Used by the preview
   *  evaluator in "Set inputs" mode and the returns dropdown. */
  smartVariableAllBlocks?: EndingBlock[];
  /** Condition rows for smart variable docs. */
  smartVariableRows?: EndingConditionRow[];
  /** Chips for smart variable doc rows. */
  smartVariableChips?: EndingConditionRowChip[];
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

  // Smart variable preview state — mode and direct result picks.
  const [modeByVariableId, setModeByVariableId] = useState<
    Record<string, "set-result" | "set-inputs">
  >({});
  const [directResultByVariableId, setDirectResultByVariableId] = useState<
    Record<string, string | null>
  >({});

  // Referenced smart_ref variables from the framework's chips/text blocks.
  const smartRefVariables = useMemo(
    () => referencedVariables.filter((v) => v.kind === "smart_ref"),
    [referencedVariables]
  );

  // Per-smart-variable returns list (for the Set result dropdown).
  const smartVariableReturnsMap = useMemo(
    () =>
      buildSmartReturnsByVariable(
        smartVariableDocs ?? [],
        variables as import("@/lib/db/types").EndingVariable[],
        smartVariableAllBlocks ?? []
      ),
    [smartVariableDocs, variables, smartVariableAllBlocks]
  );

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
  // Chips fed into aggregate resolution: the framework's own chips PLUS
  // chips from any referenced smart variable currently in `set-inputs`
  // mode. Including the latter lets aggregate ties created by a smart
  // variable's tree surface in the framework's tie-indicator panel (and
  // share the same reroll cache), so an author rerolling once gets a
  // consistent winner across parent + smart var.
  const aggregateChipsForResolution = useMemo<EvalChip[]>(() => {
    const out: EvalChip[] = [...(chips as EvalChip[])];
    if (smartRefVariables.length === 0) return out;
    const allSvBlocks = (smartVariableAllBlocks ?? []) as EvalBlock[];
    const svChips = (smartVariableChips ?? []) as EvalChip[];
    const svRows = (smartVariableRows ?? []) as EvalRow[];
    for (const sv of smartRefVariables) {
      const mode = modeByVariableId[sv.id] ?? "set-inputs";
      if (mode !== "set-inputs") continue;
      const docId = sv.smart_variable_doc_id;
      if (!docId) continue;
      const docBlockIds = new Set(
        allSvBlocks
          .filter((b) => (b as unknown as EndingBlock).document_id === docId)
          .map((b) => b.id)
      );
      const docRowIds = new Set(
        svRows.filter((r) => docBlockIds.has(r.condition_block_id)).map((r) => r.id)
      );
      for (const c of svChips) {
        if (docRowIds.has(c.row_id)) out.push(c);
      }
    }
    return out;
  }, [
    chips,
    smartRefVariables,
    smartVariableAllBlocks,
    smartVariableChips,
    smartVariableRows,
    modeByVariableId,
  ]);
  // Variables fed into the zero-default seeding: the framework's own
  // referenced variables PLUS any variables referenced by smart vars
  // in set-inputs mode (they share `selections.numbers` slots by id, so
  // any unset number_ref on either surface should still evaluate as 0).
  const seedReferencedVariables = useMemo<VariableState[]>(() => {
    const seen = new Set<string>();
    const out: VariableState[] = [];
    for (const v of referencedVariables) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        out.push(v);
      }
    }
    if (smartRefVariables.length === 0) return out;
    const allSvBlocks = (smartVariableAllBlocks ?? []) as unknown as BlockState[];
    const svRows = (smartVariableRows ?? []) as unknown as RowState[];
    const svChips = (smartVariableChips ?? []) as unknown as ChipState[];
    const varsById = new Map(variables.map((v) => [v.id, v]));
    for (const sv of smartRefVariables) {
      if ((modeByVariableId[sv.id] ?? "set-inputs") !== "set-inputs") continue;
      const docId = sv.smart_variable_doc_id;
      if (!docId) continue;
      const docBlocks = allSvBlocks.filter(
        (b) => (b as unknown as EndingBlock).document_id === docId
      );
      const docBlockIds = new Set(docBlocks.map((b) => b.id));
      const docRows = svRows.filter((r) => docBlockIds.has(r.condition_block_id));
      const docRowIds = new Set(docRows.map((r) => r.id));
      const docChips = svChips.filter((c) => docRowIds.has(c.row_id));
      const refIds = referencedVariableIdsForDoc({
        blocks: docBlocks,
        chips: docChips,
        variables,
      });
      for (const id of refIds) {
        if (seen.has(id)) continue;
        const v = varsById.get(id);
        if (!v) continue;
        seen.add(id);
        out.push(v);
      }
    }
    return out;
  }, [
    referencedVariables,
    smartRefVariables,
    smartVariableAllBlocks,
    smartVariableRows,
    smartVariableChips,
    modeByVariableId,
    variables,
  ]);
  const baseSelections = useMemo<PreviewSelections>(
    () => ({
      ...(selections ?? EMPTY_SELECTIONS),
      numbers: withZeroNumberDefaults(
        selections?.numbers ?? {},
        seedReferencedVariables
      ),
      numberRefByName,
      tiebreak_docs: tiebreakInputs,
    }),
    [selections, numberRefByName, tiebreakInputs, seedReferencedVariables]
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
      aggregateChipsForResolution,
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
  }, [aggregateChipsForResolution, variableIndex, baseSelections, rollCache]);
  // Sync newly-rolled values back into the cache so a subsequent
  // re-render with no input change keeps the same value (instead of
  // rolling fresh every render). This effect writes back into the
  // roll-cache (an internal memoization store) — not a simple prop→state
  // mirror — so the effect + setState is the correct shape here.
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

  // Resolve smart variables. For each referenced smart_ref:
  //   "set-result" mode → use the directly-chosen string value.
  //   "set-inputs" mode → evaluate the smart var's own condition tree
  //     against the shared parent selections (so world_status etc. are shared).
  const smartVariableResults = useMemo<Record<string, string | null>>(() => {
    if (smartRefVariables.length === 0) return {};

    const allSvBlocks = (smartVariableAllBlocks ?? []) as EvalBlock[];
    const svRows = (smartVariableRows ?? []) as EvalRow[];
    const svChips = (smartVariableChips ?? []) as EvalChip[];

    const setResultEntries: Record<string, string | null> = {};
    const setInputsItems: Array<{ variable_id: string; inputs: EvalInputs }> =
      [];

    const svSelectionsBase: PreviewSelections = {
      ...baseSelections,
      resolved_aggregates: resolvedAggregates,
    };

    for (const sv of smartRefVariables) {
      const mode = modeByVariableId[sv.id] ?? "set-inputs";
      if (mode === "set-result") {
        setResultEntries[sv.id] = directResultByVariableId[sv.id] ?? null;
        continue;
      }
      const docId = sv.smart_variable_doc_id;
      if (!docId) continue;
      const docBlocks = allSvBlocks.filter((b) => {
        const blk = b as unknown as EndingBlock;
        return blk.document_id === docId;
      });
      const blockIds = new Set(docBlocks.map((b) => b.id));
      const docRows = svRows.filter((r) => blockIds.has(r.condition_block_id));
      const rowIds = new Set(docRows.map((r) => r.id));
      const docChips = svChips.filter((c) => rowIds.has(c.row_id));
      setInputsItems.push({
        variable_id: sv.id,
        inputs: {
          blocks: docBlocks,
          rows: docRows,
          chips: docChips,
          variables: evalVariables,
          selections: svSelectionsBase,
          values,
        },
      });
    }

    const resolved = resolveSmartVariables(setInputsItems);
    const out: Record<string, string | null> = { ...setResultEntries };
    for (const [id, val] of resolved) out[id] = val;
    return out;
  }, [
    smartRefVariables,
    smartVariableAllBlocks,
    smartVariableRows,
    smartVariableChips,
    evalVariables,
    baseSelections,
    resolvedAggregates,
    modeByVariableId,
    directResultByVariableId,
    values,
  ]);

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
        smartVariableResults,
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
      smartVariableResults,
    ]
  );
  const evaluation = useMemo(
    () => evaluateDocumentDetailed(evalInputs, { trackPending: true }),
    [evalInputs]
  );
  const previewItems: PreviewItem[] = evaluation.previewItems ?? [];
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

  // Aggregate ties surfaced across the framework's chips AND any
  // referenced smart variable in set-inputs mode (the latter so a tie
  // produced inside a smart variable's own tree is visible — and
  // rerollable — from the framework's preview).
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
    for (const c of aggregateChipsForResolution) {
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
  }, [aggregateChipsForResolution, variables, numberRefByName, baseSelections.numbers, detailedResolution]);
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
  }, [referencedVariables]);

  // Per-smart-var: variables their condition tree depends on (for "Set inputs").
  const svInputVariableIds = useMemo(() => {
    const m = new Map<string, VariableState[]>();
    for (const sv of smartRefVariables) {
      const docId = sv.smart_variable_doc_id;
      if (!docId) continue;
      const docBlocks = (smartVariableAllBlocks ?? []).filter(
        (b) => b.document_id === docId
      ) as unknown as BlockState[];
      const docBlockIds = new Set(docBlocks.map((b) => b.id));
      const docRows = (smartVariableRows ?? []).filter((r) =>
        docBlockIds.has(r.condition_block_id)
      );
      const docRowIds = new Set(docRows.map((r) => r.id));
      const docChips = (smartVariableChips ?? []).filter((c) =>
        docRowIds.has(c.row_id)
      ) as unknown as ChipState[];
      const refIds = referencedVariableIdsForDoc({
        blocks: docBlocks,
        chips: docChips,
        variables,
      });
      m.set(sv.id, variables.filter((v) => refIds.has(v.id)));
    }
    return m;
  }, [
    smartRefVariables,
    smartVariableAllBlocks,
    smartVariableChips,
    smartVariableRows,
    variables,
  ]);

  const variableStateById = useMemo(() => {
    const m = new Map<string, VariableState>();
    for (const v of variables) m.set(v.id, v);
    return m;
  }, [variables]);
  // Header-declared variables per condition block, sorted, resolved to
  // VariableState — surfaced as chips on resolved condition headers.
  const declaredByBlock = useMemo(() => {
    const m = new Map<string, VariableState[]>();
    const sorted = [...blockVariables].sort(
      (a, b) => a.sort_order - b.sort_order
    );
    for (const bv of sorted) {
      const variable = variableStateById.get(bv.variable_id);
      if (!variable) continue;
      const list = m.get(bv.condition_block_id);
      if (list) list.push(variable);
      else m.set(bv.condition_block_id, [variable]);
    }
    return m;
  }, [blockVariables, variableStateById]);
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
              {buckets.text.map((v) => (
                <VariableInput
                  key={v.id}
                  variable={v}
                  ctx={previewCtx}
                  unresolved={unresolvedVariableNames.has(v.name)}
                />
              ))}
            </div>
          ) : null}

          {hasAnyImpacts ? (
            <div className="flex flex-wrap items-start gap-1.5">
              {buckets.classImpacts.length > 0 ? (
                <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
                  {buckets.classImpacts.map((v) => (
                    <VariableInput key={v.id} variable={v} ctx={previewCtx} />
                  ))}
                </div>
              ) : null}

              {buckets.nationImpacts.length > 0 ? (
                <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
                  {buckets.nationImpacts.map((v) => (
                    <VariableInput key={v.id} variable={v} ctx={previewCtx} />
                  ))}
                </div>
              ) : null}

              {buckets.worldImpacts.length > 0 ? (
                <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
                  {buckets.worldImpacts.map((v) => (
                    <VariableInput key={v.id} variable={v} ctx={previewCtx} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {buckets.otherNumbers.length > 0 ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {buckets.otherNumbers.map((v) => (
                <VariableInput key={v.id} variable={v} ctx={previewCtx} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {smartRefVariables.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/10 p-3">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Smart Variables
          </div>
          <div className="flex flex-col gap-3">
            {smartRefVariables.map((sv) => {
              const mode = modeByVariableId[sv.id] ?? "set-inputs";
              const returns = smartVariableReturnsMap.get(sv.id) ?? [];
              const chipColor = sv.color_hex ?? paletteColor(sv.color_index);
              const svInputVars = svInputVariableIds.get(sv.id) ?? [];
              const noResultBlocks = returns.length === 0;
              const svBuckets = {
                text: svInputVars.filter((v) => v.kind === "text"),
                classImpacts: svInputVars.filter(
                  (v) =>
                    v.kind === "number_ref" &&
                    v.number_ref != null &&
                    CLASS_IMPACT_COLS.has(v.number_ref)
                ),
                nationImpacts: svInputVars.filter(
                  (v) =>
                    v.kind === "number_ref" &&
                    v.number_ref != null &&
                    NATION_IMPACT_COLS.has(v.number_ref)
                ),
                worldImpacts: svInputVars.filter(
                  (v) =>
                    v.kind === "number_ref" &&
                    v.number_ref != null &&
                    WORLD_IMPACT_COLS.has(v.number_ref)
                ),
                otherNumbers: svInputVars.filter(
                  (v) =>
                    v.kind === "number_ref" &&
                    v.number_ref != null &&
                    !CLASS_IMPACT_COLS.has(v.number_ref) &&
                    !NATION_IMPACT_COLS.has(v.number_ref) &&
                    !WORLD_IMPACT_COLS.has(v.number_ref)
                ),
              };
              const hasSvInputs = svInputVars.length > 0;
              return (
                <div
                  key={sv.id}
                  className="flex flex-col gap-2 rounded-md border border-border/60 bg-card/30 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: chipColor }}
                      />
                      <span className="truncate text-xs font-medium text-foreground">
                        {sv.name}
                      </span>
                      {smartVariableResults[sv.id] != null ? (
                        <span className="shrink-0 font-mono text-[10px] text-[var(--primary)]">
                          → {smartVariableResults[sv.id]}
                        </span>
                      ) : (
                        <span className="shrink-0 font-mono text-[10px] italic text-muted-foreground/60">
                          → (unresolved)
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center overflow-hidden rounded border border-border">
                      <button
                        type="button"
                        aria-label="Set inputs"
                        title="Set inputs"
                        aria-pressed={mode === "set-inputs"}
                        onClick={() =>
                          setModeByVariableId((prev) => ({
                            ...prev,
                            [sv.id]: "set-inputs",
                          }))
                        }
                        className={cn(
                          "flex h-6 w-7 items-center justify-center transition-colors",
                          mode === "set-inputs"
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <SquareStack size={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={noResultBlocks}
                        aria-label="Set result"
                        title={
                          noResultBlocks
                            ? "Set result (no return values defined yet)"
                            : "Set result"
                        }
                        aria-pressed={mode === "set-result"}
                        onClick={() => {
                          if (noResultBlocks) return;
                          setModeByVariableId((prev) => ({
                            ...prev,
                            [sv.id]: "set-result",
                          }));
                        }}
                        className={cn(
                          "flex h-6 w-7 items-center justify-center border-l border-border transition-colors",
                          mode === "set-result"
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                          noResultBlocks && "cursor-not-allowed opacity-40"
                        )}
                      >
                        <Blocks size={12} aria-hidden />
                      </button>
                    </div>
                  </div>

                  {mode === "set-result" ? (
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        Result
                      </span>
                      <Select
                        aria-label={`${sv.name} result`}
                        value={directResultByVariableId[sv.id] ?? ""}
                        onChange={(e) =>
                          setDirectResultByVariableId((prev) => ({
                            ...prev,
                            [sv.id]: e.target.value || null,
                          }))
                        }
                        className={cn("h-7 flex-1 text-xs", GHOST_FIELD)}
                      >
                        <option value="">—</option>
                        {returns.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </div>
                  ) : hasSvInputs ? (
                    <div className="flex flex-col gap-1.5 pl-3.5">
                      {svBuckets.text.length > 0 ? (
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {svBuckets.text.map((v) => (
                            <VariableInput
                              key={v.id}
                              variable={v}
                              ctx={previewCtx}
                            />
                          ))}
                        </div>
                      ) : null}
                      {svBuckets.classImpacts.length > 0 ||
                      svBuckets.nationImpacts.length > 0 ||
                      svBuckets.worldImpacts.length > 0 ? (
                        <div className="flex flex-wrap items-start gap-1.5">
                          {svBuckets.classImpacts.length > 0 ? (
                            <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
                              {svBuckets.classImpacts.map((v) => (
                                <VariableInput
                                  key={v.id}
                                  variable={v}
                                  ctx={previewCtx}
                                />
                              ))}
                            </div>
                          ) : null}
                          {svBuckets.nationImpacts.length > 0 ? (
                            <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
                              {svBuckets.nationImpacts.map((v) => (
                                <VariableInput
                                  key={v.id}
                                  variable={v}
                                  ctx={previewCtx}
                                />
                              ))}
                            </div>
                          ) : null}
                          {svBuckets.worldImpacts.length > 0 ? (
                            <div className="flex items-start gap-0.5 rounded-md bg-black/20 px-1.5 py-1">
                              {svBuckets.worldImpacts.map((v) => (
                                <VariableInput
                                  key={v.id}
                                  variable={v}
                                  ctx={previewCtx}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {svBuckets.otherNumbers.length > 0 ? (
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {svBuckets.otherNumbers.map((v) => (
                            <VariableInput
                              key={v.id}
                              variable={v}
                              ctx={previewCtx}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="pl-3.5 text-[10px] italic text-muted-foreground/60">
                      No inputs — smart variable uses no conditions.
                    </div>
                  )}
                </div>
              );
            })}
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
        {previewItems.length === 0 ? (
          <p className="italic text-muted-foreground/80">
            (no blocks to render)
          </p>
        ) : (
          previewItems.map((item) => (
            <PreviewNode key={item.blockId} item={item} ctx={previewCtx} />
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
    // Token that didn't resolve (unknown name, unset value, or
    // unresolved aggregate). Render a muted dashed placeholder pill
    // naming the variable — keeps the prose readable while flagging
    // what still needs a value.
    return (
      <span
        className="mx-px inline-flex items-baseline rounded border border-dashed border-border bg-card/40 px-1 align-baseline text-[0.85em] text-muted-foreground"
        title="Variable not set — pick a value above"
      >
        {segment.variableName}
      </span>
    );
  }
  return <>{segment.text}</>;
}

/** Shared dependencies the recursive preview renderer threads down. */
type PreviewCtx = {
  variableById: Map<string, VariableState>;
  /** Header-declared variables per condition block id. */
  declaredByBlock: Map<string, VariableState[]>;
  values: EndingVariableValue[];
  selections: PreviewSelections;
  nationByName: Map<string, NationLite>;
  flashColors: Record<string, string>;
  onChangeText: (variableId: string, valueId: string | null) => void;
  onChangeNumber: (variableId: string, value: number | null) => void;
};

/**
 * One input control for a single variable — a text dropdown or an
 * impact tile / numeric field. Shared by the top "Set variable values"
 * panel and the in-preview pending-block pickers; both call the same
 * `onChangeText`/`onChangeNumber`, so a value set in either place syncs
 * everywhere. Renders nothing for an aggregate_ref variable (callers
 * only ever pass directly-settable text / number_ref variables).
 */
function VariableInput({
  variable,
  ctx,
  unresolved,
}: {
  variable: VariableState;
  ctx: PreviewCtx;
  unresolved?: boolean;
}) {
  const { values, selections, nationByName, onChangeText, onChangeNumber } =
    ctx;
  const flashColor = ctx.flashColors[variable.id];

  if (variable.kind === "text") {
    return (
      <div className="grid grid-cols-[1fr_1fr] items-center gap-2">
        <Label className={cn("!text-xs", unresolved && "text-amber-300")}>
          {variable.name}
        </Label>
        <FlashRing color={flashColor}>
          <Select
            aria-label={variable.name}
            value={selections.textValueIds[variable.id] ?? ""}
            onChange={(e) => onChangeText(variable.id, e.target.value || null)}
            className={cn("h-8", GHOST_FIELD)}
          >
            <option value="">—</option>
            {values
              .filter((val) => val.variable_id === variable.id)
              .map((val) => (
                <option key={val.id} value={val.id}>
                  {val.value}
                </option>
              ))}
          </Select>
        </FlashRing>
      </div>
    );
  }

  if (variable.kind === "number_ref" && variable.number_ref) {
    const col = variable.number_ref;
    const num = selections.numbers[variable.id] ?? 0;
    const setNum = (n: number) =>
      onChangeNumber(variable.id, n === 0 ? null : n);
    const nation = NATION_IMPACT_COLS.has(col)
      ? nationByName.get(col)
      : undefined;
    if (nation) {
      return (
        <FlashRing color={flashColor}>
          <NationImpactTile nation={nation} value={num} onChange={setNum} />
        </FlashRing>
      );
    }
    if (
      CLASS_IMPACT_COLS.has(col) ||
      WORLD_IMPACT_COLS.has(col) ||
      NATION_IMPACT_COLS.has(col)
    ) {
      const preset = presetFor(variable);
      return (
        <FlashRing color={flashColor}>
          <ImpactTile
            label={preset?.label ?? variable.name}
            icon={preset?.icon}
            value={num}
            onChange={setNum}
          />
        </FlashRing>
      );
    }
    return (
      <div className="grid grid-cols-[1fr_1fr] items-center gap-2">
        <Label className="!text-xs">{variable.name}</Label>
        <FlashRing color={flashColor}>
          <Input
            aria-label={variable.name}
            type="number"
            value={
              selections.numbers[variable.id] == null
                ? ""
                : String(selections.numbers[variable.id])
            }
            onChange={(e) => {
              const raw = e.target.value;
              onChangeNumber(variable.id, raw === "" ? null : Number(raw));
            }}
            className={cn("h-8", GHOST_FIELD)}
          />
        </FlashRing>
      </div>
    );
  }

  return null;
}

/**
 * A fired text block — bounding card, optional summary line, then the
 * substituted ending text in a dark inner well. Mirrors the morning
 * report preview's report card.
 */
function TextBlockCard({
  summary,
  segments,
}: {
  summary: string | null;
  segments: SubstitutionSegment[];
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      {summary && summary.trim() ? (
        <div className="mb-1.5 text-xs text-muted-foreground">{summary}</div>
      ) : null}
      <pre className="m-0 min-h-[3rem] whitespace-pre-wrap rounded-md bg-[var(--block-result-bg)] px-3 py-2 font-mono text-sm text-foreground">
        {segments.map((seg, j) => (
          <PreviewSegment key={j} segment={seg} />
        ))}
      </pre>
    </div>
  );
}

/**
 * A resolved condition block — its summary as a label, its matched
 * content indented beneath under a left rule so the document nesting
 * stays visible.
 */
function ConditionGroup({
  blockId,
  summary,
  items,
  ctx,
}: {
  blockId: string;
  summary: string | null;
  items: PreviewItem[];
  ctx: PreviewCtx;
}) {
  const declaredVars = ctx.declaredByBlock.get(blockId) ?? [];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {declaredVars.map((v) => (
          <VariableChip key={v.id} variable={v} />
        ))}
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {summary && summary.trim() ? summary : "Condition"}
        </span>
      </div>
      <div className="flex flex-col gap-3 border-l border-border/60 pl-3">
        {items.map((child) => (
          <PreviewNode key={child.blockId} item={child} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

/**
 * A pending condition block — dashed box with an inline picker for each
 * variable it's waiting on. Setting one updates the shared selections
 * (same handlers as the top panel); the picker then drops out and, once
 * every value resolves, the box is replaced by the block's content.
 */
function PendingConditionBox({
  summary,
  variableIds,
  ctx,
}: {
  summary: string | null;
  variableIds: string[];
  ctx: PreviewCtx;
}) {
  const pendingVars = variableIds
    .map((id) => ctx.variableById.get(id))
    .filter((v): v is VariableState => Boolean(v));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-card/40 p-3">
      <div className="text-xs italic text-muted-foreground/60">
        {summary && summary.trim() ? `${summary} — ` : ""}
        Pending: set the values below to preview this section.
      </div>
      {pendingVars.length > 0 ? (
        <div className="flex flex-col gap-2">
          {pendingVars.map((v) => (
            <VariableInput key={v.id} variable={v} ctx={ctx} />
          ))}
        </div>
      ) : (
        <div className="text-xs italic text-muted-foreground/50">
          Set the variables above to preview this section.
        </div>
      )}
    </div>
  );
}

/** Recursive preview-tree renderer — dispatches on item kind. */
function PreviewNode({ item, ctx }: { item: PreviewItem; ctx: PreviewCtx }) {
  if (item.kind === "text") {
    return <TextBlockCard summary={item.summary} segments={item.segments} />;
  }
  if (item.kind === "condition") {
    return (
      <ConditionGroup
        blockId={item.blockId}
        summary={item.summary}
        items={item.children}
        ctx={ctx}
      />
    );
  }
  return (
    <PendingConditionBox
      summary={item.summary}
      variableIds={item.variableIds}
      ctx={ctx}
    />
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
