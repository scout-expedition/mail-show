// Canonical chip colors for the seeded impact-column variables. Sourced
// from the action editor in `src/app/(authed)/inspection/letters/workspace.tsx`
// so chips referencing these variables match the rest of the app.
//
// Nation-affinity colors are NOT in here — those are read off the
// `nations.color_hex` column at render time so renames or color tweaks
// stay in sync with the Citizens / Cities / Nations data.

export const IMPACT_CHIP_COLORS: Record<string, string> = {
  world_status: "#22d3ee", // cyan-400
  demerits: "#ef4444", // red-500
  proletariat: "#f59e0b", // amber-500 (Working Class)
  gentry: "#d946ef", // fuchsia-500 (Upper Class)
};

export const NATION_NUMBER_REFS = new Set([
  "epicenter",
  "folos",
  "emberlyn",
  "spokgrad",
  "pelico",
]);

export const CLASS_NUMBER_REFS = new Set(["proletariat", "gentry"]);

/** number_refs that should display "<Name> Affinity" in chip pills. */
export const AFFINITY_NUMBER_REFS = new Set<string>([
  ...NATION_NUMBER_REFS,
  ...CLASS_NUMBER_REFS,
]);

/**
 * Chip colors for aggregate variables. We pick a neutral hue per aggregate
 * ref rather than borrowing from a single underlying column — the chip
 * represents the *competition* across columns, not any one of them.
 */
export const AGGREGATE_CHIP_COLORS: Record<string, string> = {
  class_affinity: "#f59e0b", // amber-500 — ties to the class-axis hue
  nation_affinity: "#10b981", // emerald-500 — distinct from any nation color
  nation_tiebreak_set: "#a855f7", // purple-500 — set-membership concept, distinct from scoring
};
