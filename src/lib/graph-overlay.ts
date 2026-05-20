import type {
  ActionRow,
  EndingBlock,
  EndingConditionBlockVariable,
  EndingConditionRow,
  EndingConditionRowChip,
  EndingDocument,
  EndingVariable,
  EndingVariableValue,
  InspectionActionEndingAssignment,
  Nation,
} from "@/lib/db/types";
import type { IconType } from "@/lib/db/enums";
import { paletteColor } from "@/lib/endings/color-palette";

export type ImpactCategory = "class" | "nation" | "world";

/**
 * Width (px) of a variable chip on the graph. Shared so the chip render
 * (`action-icon-edge.tsx`) and the chip-collision layout math
 * (`graph-view.tsx`) never drift apart.
 */
export const VAR_CHIP_W = 64;

/** Fixed class list (no DB table yet). */
export const IMPACT_CLASSES = [
  { key: "impact_proletariat", id: "proletariat", label: "Working", iconValue: "IconHammer", color: "#f59e0b" },
  { key: "impact_gentry", id: "gentry", label: "Gentry", iconValue: "IconDiamond", color: "#d946ef" },
] as const;

/** Fixed world-level variables. */
export const IMPACT_WORLD = [
  { key: "impact_world_status", id: "world_status", label: "World Status", iconValue: "IconWorldBolt", color: "#22d3ee", valueColor: "#ffffff" },
  { key: "impact_demerits", id: "demerits", label: "Demerits", iconValue: "IconCircleMinus", color: "#ef4444" },
] as const;

/** Nation name (lowercase) → impact column on actions. */
export const NATION_IMPACT_KEYS: Record<string, keyof ActionRow> = {
  epicenter: "impact_epicenter",
  folos: "impact_folos",
  emberlyn: "impact_emberlyn",
  spokgrad: "impact_spokgrad",
  pelico: "impact_pelico",
};

export type ImpactFilter = {
  /** Master switch — when false, all overlays are suppressed regardless
   * of the per-section toggles. The per-section state is preserved so
   * flipping the master back on restores the user's previous selection. */
  masterEnabled: boolean;
  /** When on, ending variables assigned on an action render as stacked
   * name/value chips beside that action's chip. */
  showVariables: boolean;
  categories: Record<ImpactCategory, boolean>;
  classes: Record<string, boolean>;
  nations: Record<string, boolean>;
  world: Record<string, boolean>;
  /** The explicit set of ending-variable ids whose chips show on the graph,
   * keyed by id with value `true`. A variable is shown only when its key is
   * present and `true`; missing keys are hidden. (Pre-v2 filters used the
   * inverse default — the localStorage key was bumped to discard them.) */
  variables: Record<string, boolean>;
  /** Ending framework whose variable set was last applied to `variables`
   * via the Endings dropdown. Null when no preset is active. Purely for the
   * dropdown's displayed value — the actual visibility lives in `variables`. */
  endingFrameworkId: string | null;
};

export const DEFAULT_IMPACT_FILTER: ImpactFilter = {
  masterEnabled: true,
  showVariables: false,
  categories: { class: true, nation: true, world: true },
  classes: { proletariat: true, gentry: true },
  nations: {
    epicenter: true,
    folos: true,
    emberlyn: true,
    spokgrad: true,
    pelico: true,
  },
  world: { world_status: true, demerits: true },
  variables: {},
  endingFrameworkId: null,
};

export type ActiveImpact = {
  /** Stable key so React can key lists. */
  key: string;
  /** Display label for tooltip / aria. */
  label: string;
  /** Border + icon color. */
  color: string;
  /** Optional override for the numeric value color; falls back to `color`. */
  valueColor?: string;
  /** Signed integer delta. */
  value: number;
  /** Icon descriptor consumed by IconDisplay. */
  iconType: IconType;
  iconValue: string | null;
};

/**
 * Return the non-zero impacts on an action that pass the filter, in a stable
 * display order: world status → demerits → class → nations. Returns [] when
 * impacts are hidden.
 */
export function extractActiveImpacts(
  action: ActionRow,
  filter: ImpactFilter,
  nations: Nation[]
): ActiveImpact[] {
  const out: ActiveImpact[] = [];

  // Treat missing field (legacy persisted state) as enabled.
  if (filter.masterEnabled === false) return out;

  if (filter.categories.world) {
    for (const w of IMPACT_WORLD) {
      if (!filter.world[w.id]) continue;
      const v = action[w.key] as number;
      if (!v) continue;
      out.push({
        key: `world:${w.id}`,
        label: w.label,
        color: w.color,
        valueColor: "valueColor" in w ? w.valueColor : undefined,
        value: v,
        iconType: "tabler",
        iconValue: w.iconValue,
      });
    }
  }

  if (filter.categories.class) {
    for (const c of IMPACT_CLASSES) {
      if (!filter.classes[c.id]) continue;
      const v = action[c.key] as number;
      if (!v) continue;
      out.push({
        key: `class:${c.id}`,
        label: c.label,
        color: c.color,
        value: v,
        iconType: "tabler",
        iconValue: c.iconValue,
      });
    }
  }

  if (filter.categories.nation) {
    const ordered = [...nations].sort((a, b) => a.sort_order - b.sort_order);
    for (const n of ordered) {
      const nk = NATION_IMPACT_KEYS[n.name.toLowerCase()];
      if (!nk) continue;
      if (!filter.nations[n.name.toLowerCase()]) continue;
      const v = action[nk] as number;
      if (!v) continue;
      out.push({
        key: `nation:${n.id}`,
        label: n.name,
        color: n.color_hex,
        value: v,
        iconType: n.icon_type,
        iconValue: n.icon_value,
      });
    }
  }

  return out;
}

/** An ending variable assigned on an action — name + chosen value. */
export type ActiveVariable = {
  /** Stable key (the variable id) for React lists. */
  key: string;
  /** Variable name (the chip's top half). */
  name: string;
  /** Kind — drives the leading icon on the chip's name segment. */
  kind: EndingVariable["kind"];
  /** Chosen value label, or "—" when the assignment has no value yet. */
  valueLabel: string;
  /** Variable color — border + name-segment fill. */
  color: string;
};

/**
 * Return the ending variables assigned to an action, in the variables'
 * configured `sort_order`. Returns [] when the master switch or the
 * variables overlay is off.
 */
export function extractActiveVariables(
  actionId: string,
  filter: ImpactFilter,
  endingAssignments: InspectionActionEndingAssignment[],
  variables: EndingVariable[],
  values: EndingVariableValue[]
): ActiveVariable[] {
  if (filter.masterEnabled === false) return [];
  if (!filter.showVariables) return [];

  const variableById = new Map(variables.map((v) => [v.id, v]));
  const valueById = new Map(values.map((v) => [v.id, v]));
  // `variables` is an explicit allow-set — a variable's chip shows only when
  // its id is present and `true`.
  const variableFilter = filter.variables ?? {};

  const out: { variable: EndingVariable; valueLabel: string }[] = [];
  for (const ea of endingAssignments) {
    if (ea.action_id !== actionId) continue;
    const variable = variableById.get(ea.variable_id);
    if (!variable) continue;
    if (variableFilter[variable.id] !== true) continue;
    const valueLabel = ea.value_id
      ? valueById.get(ea.value_id)?.value ?? "—"
      : "—";
    out.push({ variable, valueLabel });
  }

  out.sort((a, b) => a.variable.sort_order - b.variable.sort_order);

  return out.map(({ variable, valueLabel }) => ({
    key: variable.id,
    name: variable.name,
    kind: variable.kind,
    valueLabel,
    color: variable.color_hex ?? paletteColor(variable.color_index),
  }));
}

/** An ending framework + the ending variables its logic references. */
export type FrameworkOption = {
  id: string;
  name: string;
  /**
   * Ending-variable ids relevant to this framework: those referenced in the
   * framework's own condition blocks, PLUS those the `framework_selection`
   * logic branches on to pick this framework.
   */
  variableIds: string[];
};

/**
 * Resolve, per framework document, the set of ending variables relevant to
 * it — for the impact overlay's Endings dropdown.
 *
 * Two sources are unioned:
 *  1. The framework's own condition blocks (chips + block-level variable
 *     pickers) — the variables its madlib logic branches on.
 *  2. The `framework_selection` logic document: each `result` block whose
 *     `result_value` is this framework's id is reached through a chain of
 *     condition blocks; those blocks' variables are the logic that triggers
 *     this ending.
 */
export function computeFrameworkOptions(
  frameworks: EndingDocument[],
  blocks: EndingBlock[],
  rows: EndingConditionRow[],
  chips: EndingConditionRowChip[],
  blockVariables: EndingConditionBlockVariable[],
  frameworkSelectionDocId: string | null
): FrameworkOption[] {
  const rowsByBlock = new Map<string, EndingConditionRow[]>();
  for (const r of rows) {
    const list = rowsByBlock.get(r.condition_block_id) ?? [];
    list.push(r);
    rowsByBlock.set(r.condition_block_id, list);
  }
  const chipsByRow = new Map<string, EndingConditionRowChip[]>();
  for (const c of chips) {
    const list = chipsByRow.get(c.row_id) ?? [];
    list.push(c);
    chipsByRow.set(c.row_id, list);
  }
  const blockVarsByBlock = new Map<string, EndingConditionBlockVariable[]>();
  for (const bv of blockVariables) {
    const list = blockVarsByBlock.get(bv.condition_block_id) ?? [];
    list.push(bv);
    blockVarsByBlock.set(bv.condition_block_id, list);
  }
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  // Variable ids referenced by a single condition block — its block-level
  // variable pickers plus every chip across its rows.
  function variablesOfConditionBlock(blockId: string): string[] {
    const out: string[] = [];
    for (const bv of blockVarsByBlock.get(blockId) ?? []) {
      out.push(bv.variable_id);
    }
    for (const row of rowsByBlock.get(blockId) ?? []) {
      for (const chip of chipsByRow.get(row.id) ?? []) {
        out.push(chip.variable_id);
      }
    }
    return out;
  }

  // Walk up the parent-block chain from `result`, collecting variables from
  // every enclosing condition block (handles nested conditions). The `seen`
  // set guards against a malformed parent_block_id cycle looping forever.
  function variablesOnPathToResult(resultBlock: EndingBlock): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    let cursor = resultBlock.parent_block_id;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const ancestor = blockById.get(cursor);
      if (!ancestor) break;
      if (ancestor.block_type === "condition") {
        out.push(...variablesOfConditionBlock(ancestor.id));
      }
      cursor = ancestor.parent_block_id;
    }
    return out;
  }

  // framework id → variables the framework_selection logic branches on to
  // reach it.
  const triggerVarsByFramework = new Map<string, Set<string>>();
  if (frameworkSelectionDocId) {
    for (const block of blocks) {
      if (block.document_id !== frameworkSelectionDocId) continue;
      if (block.block_type !== "result" || !block.result_value) continue;
      const set =
        triggerVarsByFramework.get(block.result_value) ?? new Set<string>();
      for (const vid of variablesOnPathToResult(block)) set.add(vid);
      triggerVarsByFramework.set(block.result_value, set);
    }
  }

  return frameworks.map((fw) => {
    const variableIds = new Set<string>();
    for (const block of blocks) {
      if (block.document_id !== fw.id || block.block_type !== "condition") {
        continue;
      }
      for (const vid of variablesOfConditionBlock(block.id)) {
        variableIds.add(vid);
      }
    }
    for (const vid of triggerVarsByFramework.get(fw.id) ?? []) {
      variableIds.add(vid);
    }
    return {
      id: fw.id,
      name: fw.name ?? "Untitled framework",
      variableIds: [...variableIds],
    };
  });
}
