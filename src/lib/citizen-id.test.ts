import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCitizenIdInput,
  generateRandomCitizenId,
  isValidCitizenId,
} from "./citizen-id";

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

describe("generateRandomCitizenId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return a syntactically valid id when nothing is taken", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(isValidCitizenId(generateRandomCitizenId(new Set()))).toBe(true);
  });

  it("should pick a different id when the first random candidate is taken", () => {
    // Math.random=0 → "#AAAA". Mark it taken; next pick at 1/35 → "#BBBB".
    const taken = new Set<string>(["#AAAA"]);
    const seq = [0, 0, 0, 0, 1 / 35, 1 / 35, 1 / 35, 1 / 35];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[i++ % seq.length]);
    const out = generateRandomCitizenId(taken);
    expect(out).not.toBe("#AAAA");
    expect(isValidCitizenId(out)).toBe(true);
  });

  it("should fall back to alphabet walk when 100 random picks all collide", () => {
    // Force every random call to map to "#AAAA".
    vi.spyOn(Math, "random").mockReturnValue(0);
    const taken = new Set<string>(["#AAAA"]);
    const out = generateRandomCitizenId(taken);
    // Walk skips taken="#AAAA" and lands on the next combination, "#AAAB".
    expect(out).toBe("#AAAB");
  });
});
