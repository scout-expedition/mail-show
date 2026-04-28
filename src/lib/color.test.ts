import { describe, expect, it } from "vitest";
import { normalizeHex } from "./color";

describe("normalizeHex", () => {
  it("should accept 6-char hex with leading hash and lowercase it", () => {
    expect(normalizeHex("#ABC123")).toBe("#abc123");
  });

  it("should accept 6-char hex without a leading hash", () => {
    expect(normalizeHex("abc123")).toBe("#abc123");
  });

  it("should expand 3-char shorthand to 6-char form", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("ABC")).toBe("#aabbcc");
  });

  it.each([
    ["", "empty"],
    ["xyz", "non-hex chars"],
    ["#1234", "wrong length 4"],
    ["#12345", "wrong length 5"],
    ["#1234567", "wrong length 7"],
  ])("should fall back to #888888 for %s (%s)", (input) => {
    expect(normalizeHex(input)).toBe("#888888");
  });

  it("should trim surrounding whitespace before validating", () => {
    expect(normalizeHex("  #abc123  ")).toBe("#abc123");
  });
});
