import { describe, expect, it } from "vitest";
import { filterVariables, type VariableLike } from "./variable-filter";

function v(name: string, kind: VariableLike["kind"] = "text"): VariableLike {
  return {
    id: name.toLowerCase().replace(/\s/g, "-"),
    name,
    kind,
    color_index: 0,
    color_hex: null,
  };
}

describe("filterVariables", () => {
  const list = [v("Alpha"), v("Beta"), v("Gamma"), v("Alphabet")];

  it("returns all variables alphabetically when query is empty", () => {
    const out = filterVariables(list, "");
    expect(out.map((x) => x.name)).toEqual([
      "Alpha",
      "Alphabet",
      "Beta",
      "Gamma",
    ]);
  });

  it("ranks prefix matches before substring matches within a group", () => {
    // "al" prefix-matches Alpha + Alphabet; nothing substring-only.
    const out = filterVariables(list, "al");
    expect(out.map((x) => x.name)).toEqual(["Alpha", "Alphabet"]);
  });

  it("is case-insensitive", () => {
    const out = filterVariables(list, "GAM");
    expect(out.map((x) => x.name)).toEqual(["Gamma"]);
  });

  it("trims whitespace from the query", () => {
    const out = filterVariables(list, "  al  ");
    expect(out.map((x) => x.name)).toEqual(["Alpha", "Alphabet"]);
  });

  it("returns an empty array on no matches", () => {
    expect(filterVariables(list, "zzz")).toEqual([]);
  });

  it("sorts within each tier alphabetically", () => {
    const mixed = [v("Beta"), v("Alpha"), v("Apex"), v("Banana")];
    // prefix on 'a': Alpha, Apex (sorted). substring containing 'a': Beta,
    // Banana (sorted).
    expect(filterVariables(mixed, "a").map((x) => x.name)).toEqual([
      "Alpha",
      "Apex",
      "Banana",
      "Beta",
    ]);
  });

  it("groups by kind: text → number_ref → aggregate_ref", () => {
    const mixed = [
      v("Score", "number_ref"),
      v("Performer", "text"),
      v("Class Winner", "aggregate_ref"),
      v("City", "text"),
      v("Demerits", "number_ref"),
    ];
    const out = filterVariables(mixed, "");
    // Text first (City, Performer), then number (Demerits, Score), then
    // aggregate (Class Winner). Alphabetical within each group.
    expect(out.map((x) => x.name)).toEqual([
      "City",
      "Performer",
      "Demerits",
      "Score",
      "Class Winner",
    ]);
  });

  it("preserves group order even when a query filters some groups empty", () => {
    const mixed = [
      v("Performer", "text"),
      v("Demerits", "number_ref"),
      v("Top Class", "aggregate_ref"),
    ];
    // Query "er" matches "Performer" (text, substring) and "Demerits"
    // (number, substring); no aggregate match.
    const out = filterVariables(mixed, "er");
    expect(out.map((x) => x.name)).toEqual(["Performer", "Demerits"]);
  });

  it("ranks prefix-before-substring within a group, not globally", () => {
    const mixed = [
      v("Performer", "text"), // text, substring on "er"
      v("Ergonomics", "number_ref"), // number, prefix on "er"
      v("Era", "text"), // text, prefix on "er"
    ];
    // Text group: Era (prefix), Performer (substring). Number group:
    // Ergonomics (prefix). Number prefix does NOT leapfrog text
    // substring because grouping wins.
    const out = filterVariables(mixed, "er");
    expect(out.map((x) => x.name)).toEqual([
      "Era",
      "Performer",
      "Ergonomics",
    ]);
  });
});
