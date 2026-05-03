// Auto-assigned colors for ending variables. Variable color_index lives on
// the row (assigned at insert time via `colorIndexFor(id)`); UI looks up the
// hex via `paletteColor(color_index)`.

export const ENDING_VARIABLE_PALETTE = [
  "#7aa2f7", // blue
  "#9ece6a", // green
  "#e0af68", // amber
  "#f7768e", // pink
  "#bb9af7", // purple
  "#73daca", // teal
  "#ff9e64", // orange
  "#7dcfff", // sky
  "#c0caf5", // lavender
  "#cd6f6f", // rust
  "#a6c47b", // moss
  "#d6a36c", // sand
] as const;

export const ENDING_VARIABLE_PALETTE_SIZE = ENDING_VARIABLE_PALETTE.length;

/**
 * Deterministic hash of an id (typically a UUID) into [0, palette length).
 * Stable across renames — the color is anchored to the row's identity, not
 * its name. Uses FNV-1a 32-bit so it's portable to Postgres if we ever move
 * the assignment server-side.
 */
export function colorIndexFor(id: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  // Coerce to unsigned and modulo into the palette range.
  const unsigned = hash >>> 0;
  return unsigned % ENDING_VARIABLE_PALETTE_SIZE;
}

/** Hex color for a stored color_index. Out-of-range falls back to bucket 0. */
export function paletteColor(colorIndex: number): string {
  if (
    !Number.isFinite(colorIndex) ||
    colorIndex < 0 ||
    colorIndex >= ENDING_VARIABLE_PALETTE_SIZE
  ) {
    return ENDING_VARIABLE_PALETTE[0];
  }
  return ENDING_VARIABLE_PALETTE[Math.floor(colorIndex)];
}
