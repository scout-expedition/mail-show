"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GHOST_FIELD } from "@/components/panel";
import { cn } from "@/lib/utils";
import { FlashRing } from "@/lib/realtime/flash-ring";
import type { PreviewSelections } from "@/lib/endings/evaluator";
import type { VariableState } from "@/lib/endings/block-state";
import type { EndingVariableValue, Nation } from "@/lib/db/types";
import { IMPACT_TILE_PRESETS, ImpactTile, NationImpactTile } from "@/components/impact-tile";

// Impact-column buckets — shared by the top "Set variable values" panel
// and the in-preview pending-block pickers.
export const NATION_IMPACT_COLS = new Set([
  "folos",
  "emberlyn",
  "spokgrad",
  "pelico",
  "epicenter",
]);
export const CLASS_IMPACT_COLS = new Set(["proletariat", "gentry"]);
export const WORLD_IMPACT_COLS = new Set(["world_status", "demerits"]);

type NationLite = Pick<
  Nation,
  "name" | "color_hex" | "abbreviation" | "icon_type" | "icon_value"
>;

/** Shared dependencies the recursive preview renderer threads down. */
export type PreviewCtx = {
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
 * Returns a `numbers` map seeded with 0 for every referenced number_ref
 * variable not already explicitly set. Mirrors real-playthrough
 * semantics: every impact column starts at 0, so unset chips evaluate
 * against 0 rather than falling through as "pending."
 */
export function withZeroNumberDefaults(
  numbers: Record<string, number | null>,
  referencedVariables: ReadonlyArray<{ id: string; kind: VariableState["kind"] }>
): Record<string, number | null> {
  const out: Record<string, number | null> = { ...numbers };
  for (const v of referencedVariables) {
    if (v.kind !== "number_ref") continue;
    if (out[v.id] != null) continue;
    out[v.id] = 0;
  }
  return out;
}

export function presetFor(v: VariableState) {
  return v.number_ref ? IMPACT_TILE_PRESETS[v.number_ref] : undefined;
}

/**
 * Returns `{ text, classImpacts, nationImpacts, worldImpacts, otherNumbers }`
 * from a list of referenced variables. aggregate_ref variables are skipped —
 * they resolve via their underlying number_ref entries.
 */
export function bucketReferencedVariables(refs: VariableState[]) {
  const text: VariableState[] = [];
  const classImpacts: VariableState[] = [];
  const nationImpacts: VariableState[] = [];
  const worldImpacts: VariableState[] = [];
  const otherNumbers: VariableState[] = [];
  for (const v of refs) {
    if (v.kind === "text") {
      text.push(v);
    } else if (v.kind === "number_ref" && v.number_ref) {
      if (CLASS_IMPACT_COLS.has(v.number_ref)) classImpacts.push(v);
      else if (NATION_IMPACT_COLS.has(v.number_ref)) nationImpacts.push(v);
      else if (WORLD_IMPACT_COLS.has(v.number_ref)) worldImpacts.push(v);
      else otherNumbers.push(v);
    }
  }
  return { text, classImpacts, nationImpacts, worldImpacts, otherNumbers };
}

/**
 * One input control for a single variable — a text dropdown or an
 * impact tile / numeric field. Shared by the top "Set variable values"
 * panel and the in-preview pending-block pickers; both call the same
 * `onChangeText`/`onChangeNumber`, so a value set in either place syncs
 * everywhere. Renders nothing for an aggregate_ref variable (callers
 * only ever pass directly-settable text / number_ref variables).
 */
export function VariableInput({
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
    const setNum = (n: number) => onChangeNumber(variable.id, n);
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
 * The "Set variable values" card — renders text dropdowns and impact
 * tiles for all variables referenced by the current framework. Shared
 * between the frameworks and logic preview surfaces.
 */
export function ReferencedVariablesPanel({
  referencedVariables,
  ctx,
  unresolvedVariableNames,
}: {
  referencedVariables: VariableState[];
  ctx: PreviewCtx;
  unresolvedVariableNames: Set<string>;
}) {
  const buckets = bucketReferencedVariables(referencedVariables);
  const hasAnyImpacts =
    buckets.classImpacts.length > 0 ||
    buckets.nationImpacts.length > 0 ||
    buckets.worldImpacts.length > 0;

  if (referencedVariables.length === 0) return null;

  return (
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
              ctx={ctx}
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
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {buckets.otherNumbers.map((v) => (
            <VariableInput key={v.id} variable={v} ctx={ctx} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
