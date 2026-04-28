import { describe, expect, it } from "vitest";
import {
  formatDurationMMSS,
  formatSortId,
  lpad,
  parseDurationToSeconds,
  toRoman,
} from "./utils";

describe("lpad", () => {
  it("should left-pad numbers with zeros to the requested length", () => {
    expect(lpad(7, 3)).toBe("007");
  });

  it("should not pad when the value is already at or beyond the requested length", () => {
    expect(lpad(123, 2)).toBe("123");
  });

  it("should accept a custom pad character", () => {
    expect(lpad(5, 3, "x")).toBe("xx5");
  });
});

describe("formatSortId", () => {
  it("should zero-pad to 2 digits", () => {
    expect(formatSortId(9)).toBe("09");
    expect(formatSortId(99)).toBe("99");
  });
});

describe("parseDurationToSeconds", () => {
  it("should return null for empty input", () => {
    expect(parseDurationToSeconds("")).toBeNull();
    expect(parseDurationToSeconds("   ")).toBeNull();
  });

  it("should parse MM:SS form", () => {
    expect(parseDurationToSeconds("5:00")).toBe(300);
    expect(parseDurationToSeconds("5:30")).toBe(330);
  });

  it("should treat dots and runs of separators as a colon", () => {
    expect(parseDurationToSeconds("5.00")).toBe(300);
    expect(parseDurationToSeconds("5..00")).toBe(300);
    expect(parseDurationToSeconds("5. .00")).toBe(300);
  });

  it("should treat a plain number as seconds", () => {
    expect(parseDurationToSeconds("90")).toBe(90);
  });

  it("should return null for non-numeric input", () => {
    expect(parseDurationToSeconds("abc")).toBeNull();
    expect(parseDurationToSeconds("5:abc")).toBeNull();
  });

  it("should strip trailing colons and treat the remainder as plain seconds", () => {
    // The normalization step strips a trailing ":" before parsing, so "5:"
    // becomes "5" → 5 seconds (not 5 minutes).
    expect(parseDurationToSeconds("5:")).toBe(5);
  });
});

describe("formatDurationMMSS", () => {
  it("should return an empty string for null or undefined", () => {
    expect(formatDurationMMSS(null)).toBe("");
    expect(formatDurationMMSS(undefined)).toBe("");
  });

  it("should return an empty string for non-finite numbers", () => {
    expect(formatDurationMMSS(Number.NaN)).toBe("");
    expect(formatDurationMMSS(Number.POSITIVE_INFINITY)).toBe("");
  });

  it("should format seconds as MM:SS", () => {
    expect(formatDurationMMSS(0)).toBe("00:00");
    expect(formatDurationMMSS(5)).toBe("00:05");
    expect(formatDurationMMSS(65)).toBe("01:05");
    expect(formatDurationMMSS(600)).toBe("10:00");
  });
});

describe("toRoman", () => {
  it.each([
    [1, "i"],
    [4, "iv"],
    [5, "v"],
    [9, "ix"],
    [40, "xl"],
    [90, "xc"],
    [400, "cd"],
    [900, "cm"],
    [1999, "mcmxcix"],
    [3999, "mmmcmxcix"],
  ])("should convert %i to %s", (input, expected) => {
    expect(toRoman(input)).toBe(expected);
  });

  it("should return the stringified number for out-of-range inputs", () => {
    expect(toRoman(0)).toBe("0");
    expect(toRoman(-1)).toBe("-1");
    expect(toRoman(4000)).toBe("4000");
  });
});
