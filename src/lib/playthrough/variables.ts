import type { ActionRow, PlaythroughVariables } from "@/lib/db/types";

export const ZERO_VARIABLES: Omit<PlaythroughVariables, "playthrough_id"> = {
  world_status: 0,
  demerits: 0,
  proletariat: 0,
  gentry: 0,
  epicenter: 0,
  folos: 0,
  emberlyn: 0,
  spokgrad: 0,
  pelico: 0,
  combined_national: 0,
};

/** Sum the impact columns across the actions chosen in a playthrough. */
export function tallyVariables(
  actions: ActionRow[]
): Omit<PlaythroughVariables, "playthrough_id"> {
  const acc = { ...ZERO_VARIABLES };
  for (const a of actions) {
    acc.world_status += a.impact_world_status;
    acc.demerits += a.impact_demerits;
    acc.proletariat += a.impact_proletariat;
    acc.gentry += a.impact_gentry;
    acc.epicenter += a.impact_epicenter;
    acc.folos += a.impact_folos;
    acc.emberlyn += a.impact_emberlyn;
    acc.spokgrad += a.impact_spokgrad;
    acc.pelico += a.impact_pelico;
  }
  // Combined = all national except Epicenter, per plan.
  acc.combined_national =
    acc.folos + acc.emberlyn + acc.spokgrad + acc.pelico;
  return acc;
}

export const VARIABLE_LABELS = {
  world_status: "World Status",
  demerits: "Demerits",
  proletariat: "Working",
  gentry: "Gentry",
  epicenter: "Epicenter",
  folos: "Folos",
  emberlyn: "Emberlyn",
  spokgrad: "Spokgrad",
  pelico: "Pelico",
  combined_national: "Combined Nat'l",
} as const;
