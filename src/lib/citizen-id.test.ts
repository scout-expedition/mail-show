import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displayCitizenId,
  formatCitizenIdInput,
  generateRandomCitizenId,
  isValidCitizenId,
  toStorageCitizenId,
} from "./citizen-id";

const RAW_BODY_RE = /^[A-HJ-Z0-9]{4}$/;

describe("formatCitizenIdInput", () => {
  it("should return empty string for empty input", () => {
    expect(formatCitizenIdInput("")).toBe("");
  });

  it("should uppercase, strip leading hashes, and prefix a single hash", () => {
    expect(formatCitizenIdInput("##abc1")).toBe("#ABC1");
  });

  it("should drop forbidden characters (including the letter I)", () => {
    expect(formatCitizenIdInput("AI23")).toBe("#A23");
  });

  it("should truncate to 4 characters in the body", () => {
    expect(formatCitizenIdInput("ABCDEF")).toBe("#ABCD");
  });

  it("should return empty string when no valid characters remain", () => {
    expect(formatCitizenIdInput("###")).toBe("");
    expect(formatCitizenIdInput("iii")).toBe("");
  });
});

describe("isValidCitizenId", () => {
  it.each([
    ["#A1B2", true],
    ["#9999", true],
    ["A1B2", false], // missing hash
    ["#A1B2C", false], // too long
    ["#A1B", false], // too short
    ["#a1b2", false], // lowercase
    ["#I123", false], // contains forbidden I
    ["", false],
  ])("should return %s for %s", (input, expected) => {
    expect(isValidCitizenId(input)).toBe(expected);
  });
});

describe("toStorageCitizenId", () => {
  it.each([
    [null, null],
    [undefined, null],
    ["", null],
    ["   ", null],
    ["#", null],
    ["#A1B2", "A1B2"],
    ["A1B2", "A1B2"],
    [" #a1b2 ", "A1B2"],
    ["##A1B2", "A1B2"],
  ])("should map %p to %p", (input, expected) => {
    expect(toStorageCitizenId(input)).toBe(expected);
  });
});

describe("displayCitizenId", () => {
  it.each([
    [null, ""],
    [undefined, ""],
    ["", ""],
    ["A1B2", "#A1B2"],
    ["0042", "#0042"],
  ])("should map %p to %p", (input, expected) => {
    expect(displayCitizenId(input)).toBe(expected);
  });
});

describe("generateRandomCitizenId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return a raw 4-char body when nothing is taken", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const out = generateRandomCitizenId(new Set());
    expect(RAW_BODY_RE.test(out)).toBe(true);
  });

  it("should pick a different id when the first random candidate is taken", () => {
    // Math.random=0 → "AAAA". Mark it taken; next pick at 1/35 → "BBBB".
    const taken = new Set<string>(["AAAA"]);
    const seq = [0, 0, 0, 0, 1 / 35, 1 / 35, 1 / 35, 1 / 35];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++ % seq.length]);
    const out = generateRandomCitizenId(taken);
    expect(out).not.toBe("AAAA");
    expect(RAW_BODY_RE.test(out)).toBe(true);
  });

  it("should fall back to alphabet walk when 100 random picks all collide", () => {
    // Force every random call to map to "AAAA".
    vi.spyOn(Math, "random").mockReturnValue(0);
    const taken = new Set<string>(["AAAA"]);
    const out = generateRandomCitizenId(taken);
    // Walk skips taken="AAAA" and lands on the next combination, "AAAB".
    expect(out).toBe("AAAB");
  });
});
