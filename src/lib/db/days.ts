/** URL path segment (e.g. "d1", "D1", "1") → canonical identifier "D1". */
export function normalizeDayIdentifier(segment: string): string {
  const s = segment.trim();
  if (!s) return "";
  const bare = s.replace(/^[dD]/, "");
  const n = Number(bare);
  if (!Number.isFinite(n)) return s.toUpperCase();
  return `D${n}`;
}
