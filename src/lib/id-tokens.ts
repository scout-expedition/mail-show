/**
 * id-tokens.ts
 *
 * Pure codec helpers for the three kinds of display-ID "number tokens" used in
 * the mail-show UI:
 *
 *  - Integer string  (letter groups): "1", "2", "3", …
 *  - Lowercase roman (report segments): "i", "ii", "iii", "iv", …
 *  - Lowercase letter (inspection-letter variants): "a", "b", … "z"
 *
 * No React, no DB, no side-effects.
 */

// ---------------------------------------------------------------------------
// Roman numerals
// ---------------------------------------------------------------------------

const ROMAN_PAIRS: Array<[number, string]> = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

const ROMAN_CHAR_MAP: Record<string, number> = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};

/**
 * Convert a positive integer to a lowercase subtractive roman-numeral string.
 * Returns "" for n <= 0 (caller must guard).
 *
 * Examples: 1→"i", 4→"iv", 9→"ix", 14→"xiv", 40→"xl"
 */
export function intToRoman(n: number): string {
  if (n <= 0) return "";
  let out = "";
  let rem = n;
  for (const [val, sym] of ROMAN_PAIRS) {
    while (rem >= val) {
      out += sym;
      rem -= val;
    }
  }
  return out;
}

/**
 * Parse a lowercase roman-numeral string back to an integer.
 * Validates by round-trip: returns `n` only when `intToRoman(n) === normalised(s)`.
 * Returns null for empty strings, non-roman characters, or non-canonical forms
 * (e.g. "iiii" which would parse to 4 but intToRoman(4) is "iv").
 */
export function romanToInt(s: string): number | null {
  const norm = s.toLowerCase().trim();
  if (norm.length === 0) return null;

  // Greedily sum subtractive notation
  let total = 0;
  for (let i = 0; i < norm.length; i++) {
    const cur = ROMAN_CHAR_MAP[norm[i]];
    if (cur == null) return null;
    const next = ROMAN_CHAR_MAP[norm[i + 1]];
    if (next != null && cur < next) total -= cur;
    else total += cur;
  }

  // Round-trip validation: only canonical forms are accepted
  if (total <= 0 || intToRoman(total) !== norm) return null;
  return total;
}

/** Returns true iff `s` is a non-empty valid lowercase roman numeral. */
export function isValidRoman(s: string): boolean {
  return romanToInt(s) !== null;
}

/**
 * Filter a text-input value to only roman-numeral characters (i v x l c d m),
 * lowercased. Safe to call on every keypress.
 */
export function formatRomanInput(raw: string): string {
  return raw.toLowerCase().replace(/[^ivxlcdm]/g, "");
}

// ---------------------------------------------------------------------------
// Single-letter (inspection-letter variant) tokens
// ---------------------------------------------------------------------------

/**
 * Map a single lowercase letter to its 1-based position (a→1, z→26).
 * Returns null for anything that is not exactly one a–z character.
 */
export function letterToInt(s: string): number | null {
  const norm = s.toLowerCase().trim();
  if (norm.length !== 1) return null;
  const code = norm.charCodeAt(0);
  if (code < 97 || code > 122) return null; // 'a' = 97, 'z' = 122
  return code - 96; // 'a' → 1
}

/**
 * Map a 1-based position back to a lowercase letter (1→"a", 26→"z").
 * Returns "" for values outside 1–26 — caller must guard.
 */
export function intToLetter(n: number): string {
  if (n < 1 || n > 26) return "";
  return String.fromCharCode(96 + n); // 1 → 'a'
}

/**
 * Filter a text-input value to a single lowercase a–z character.
 * Takes the FIRST valid a–z character found, returns "" if none exists.
 */
export function formatLetterInput(raw: string): string {
  const lower = raw.toLowerCase();
  for (const ch of lower) {
    if (ch >= "a" && ch <= "z") return ch;
  }
  return "";
}
