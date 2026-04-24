import type { ActionRow, Nation } from "@/lib/db/types";
import type { IconType } from "@/lib/db/enums";

export type ImpactCategory = "class" | "nation" | "world";

/** Fixed class list (no DB table yet). */
export const IMPACT_CLASSES = [
  { key: "impact_proletariat", id: "proletariat", label: "Working" },
  { key: "impact_gentry", id: "gentry", label: "Gentry" },
] as const;

/** Fixed world-level variables. */
export const IMPACT_WORLD = [
  { key: "impact_world_status", id: "world_status", label: "World Status" },
  { key: "impact_demerits", id: "demerits", label: "Demerits" },
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
  showImpacts: boolean;
  /** When on, chips whose action sets any ending variable get a flag marker. */
  showEndings: boolean;
  categories: Record<ImpactCategory, boolean>;
  classes: Record<string, boolean>;
  nations: Record<string, boolean>;
  world: Record<string, boolean>;
};

export const DEFAULT_IMPACT_FILTER: ImpactFilter = {
  showImpacts: false,
  showEndings: false,
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
  if (!filter.showImpacts) return [];
  const out: ActiveImpact[] = [];

  if (filter.categories.world) {
    for (const w of IMPACT_WORLD) {
      if (!filter.world[w.id]) continue;
      const v = action[w.key] as number;
      if (!v) continue;
      // World Status stays all-white (border, icon, and value), demerits
      // stays full-red.
      const isDemerits = w.id === "demerits";
      const color = isDemerits ? "#ef4444" : "#ffffff";
      out.push({
        key: `world:${w.id}`,
        label: w.label,
        color,
        value: v,
        iconType: "tabler",
        iconValue: isDemerits ? "IconMinus" : "IconWorldBolt",
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
        color: c.id === "gentry" ? "#d946ef" : "#f59e0b",
        value: v,
        iconType: "tabler",
        iconValue: c.id === "gentry" ? "IconDiamond" : "IconHammer",
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
