/**
 * URL slug for inspection letter groups: storyline abbreviation + sequence.
 * Abbreviations are constrained to a single uppercase char in the schema
 * (char(1)), so the slug regex is [A-Z] followed by digits.
 */
export function groupSlug(abbreviation: string, sequence: number): string {
  return `${abbreviation}${sequence}`;
}

const SLUG_RE = /^([A-Z])(\d+)$/;

export function parseGroupSlug(
  slug: string
): { abbreviation: string; sequence: number } | null {
  const m = SLUG_RE.exec(slug);
  if (!m) return null;
  const seq = Number(m[2]);
  if (!Number.isFinite(seq) || seq <= 0) return null;
  return { abbreviation: m[1], sequence: seq };
}
