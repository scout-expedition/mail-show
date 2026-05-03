import { describe, expect, it } from "vitest";
import {
  ENDING_VARIABLE_PALETTE,
  ENDING_VARIABLE_PALETTE_SIZE,
  colorIndexFor,
  paletteColor,
} from "./color-palette";

describe("colorIndexFor", () => {
  it("returns a value in [0, palette size)", () => {
    for (const id of [
      "00000000-0000-0000-0000-000000000000",
      "5f5f5f5f-5f5f-5f5f-5f5f-5f5f5f5f5f5f",
      "abcdef",
      "x",
    ]) {
      const idx = colorIndexFor(id);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(ENDING_VARIABLE_PALETTE_SIZE);
      expect(Number.isInteger(idx)).toBe(true);
    }
  });

  it("is deterministic for the same id", () => {
    const id = "8f14e45f-ceea-467a-9575-d22b1aef93cd";
    expect(colorIndexFor(id)).toBe(colorIndexFor(id));
  });

  it("is stable across renames (only id matters — by construction)", () => {
    const id = "abc-123";
    const before = colorIndexFor(id);
    // The function only takes an id; if a caller passes a different id,
    // they get a different bucket. Renaming a variable does not change its id.
    expect(before).toBe(colorIndexFor(id));
  });

  it("distributes 1000 random uuid-shaped ids across all 12 buckets", () => {
    const counts = new Array(ENDING_VARIABLE_PALETTE_SIZE).fill(0);
    for (let i = 0; i < 1000; i++) {
      const id = `${i.toString(16)}-${Math.random().toString(16).slice(2)}`;
      counts[colorIndexFor(id)]++;
    }
    for (const c of counts) {
      // Each bucket should fire at least 30 times in 1000 draws if hashing
      // is even close to uniform (~83 expected per bucket).
      expect(c).toBeGreaterThan(30);
    }
  });
});

describe("paletteColor", () => {
  it("returns the hex at the requested index", () => {
    for (let i = 0; i < ENDING_VARIABLE_PALETTE_SIZE; i++) {
      expect(paletteColor(i)).toBe(ENDING_VARIABLE_PALETTE[i]);
    }
  });

  it("falls back to bucket 0 for out-of-range indexes", () => {
    expect(paletteColor(-1)).toBe(ENDING_VARIABLE_PALETTE[0]);
    expect(paletteColor(ENDING_VARIABLE_PALETTE_SIZE)).toBe(
      ENDING_VARIABLE_PALETTE[0]
    );
    expect(paletteColor(Number.NaN)).toBe(ENDING_VARIABLE_PALETTE[0]);
  });

  it("floors fractional indexes", () => {
    expect(paletteColor(2.7)).toBe(ENDING_VARIABLE_PALETTE[2]);
  });
});
