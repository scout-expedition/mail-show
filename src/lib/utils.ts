import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function lpad(value: number | string, length: number, char = "0"): string {
  return String(value).padStart(length, char);
}

/** Format a number slot like "09" for sort_id in S#-##. */
export function formatSortId(sortId: number): string {
  return lpad(sortId, 2);
}

/**
 * Parse a user-entered duration into seconds.
 * Accepts "5:00", "5.00", "5..00" (→ 5 minutes), or a plain number (→ seconds).
 * Returns null for empty/invalid input.
 */
export function parseDurationToSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[.:\s]+/g, ":").replace(/^:|:$/g, "");
  if (!normalized) return null;
  if (normalized.includes(":")) {
    const [mm, ss = "0"] = normalized.split(":");
    const m = Number(mm);
    const s = Number(ss);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    return Math.trunc(m) * 60 + Math.trunc(s);
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Render a seconds count as "MM:SS". */
export function formatDurationMMSS(total: number | null | undefined): string {
  if (total == null || !Number.isFinite(total)) return "";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Turn an integer into a lowercase roman numeral ("i", "ii", "iii"...). */
export function toRoman(num: number): string {
  if (num <= 0 || num > 3999) return String(num);
  const map: Array<[number, string]> = [
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
  let out = "";
  let n = num;
  for (const [val, sym] of map) {
    while (n >= val) {
      out += sym;
      n -= val;
    }
  }
  return out;
}
