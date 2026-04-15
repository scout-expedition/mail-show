/** Accept "abc123", "#abc123", "#ABC", and normalize to "#abc123". */
export function normalizeHex(raw: string): string {
  let s = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return "#888888";
  return `#${s.toLowerCase()}`;
}
