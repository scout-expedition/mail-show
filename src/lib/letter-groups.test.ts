import { describe, expect, it } from "vitest";
import { groupSlug, parseGroupSlug } from "./letter-groups";

describe("groupSlug", () => {
  it("should concatenate abbreviation and sequence", () => {
    expect(groupSlug("W", 2)).toBe("W2");
  });
});

describe("parseGroupSlug", () => {
  it("should round-trip a valid slug", () => {
    const parsed = parseGroupSlug("W12");
    expect(parsed).toEqual({ abbreviation: "W", sequence: 12 });
  });

  it.each([
    ["", "empty"],
    ["w2", "lowercase abbreviation"],
    ["W", "missing sequence"],
    ["W0", "zero sequence"],
    ["WW2", "multi-char abbreviation"],
    ["1W", "abbreviation in wrong position"],
  ])("should return null for %s (%s)", (slug) => {
    expect(parseGroupSlug(slug)).toBeNull();
  });
});
