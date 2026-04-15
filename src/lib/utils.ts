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
