import { describe, expect, it } from "vitest";
import {
  detectMentionTrigger,
  filterVariablesForMention,
} from "./mention-autocomplete";
import type { VariableState } from "@/lib/endings/block-state";

// ---------------------------------------------------------------------
// detectMentionTrigger
// ---------------------------------------------------------------------

describe("detectMentionTrigger", () => {
  it("returns null when there's no `@` before the caret", () => {
    expect(detectMentionTrigger("plain text", 5)).toBeNull();
  });

  it("opens with empty query when caret is right after `@`", () => {
    expect(detectMentionTrigger("hi @", 4)).toEqual({ atIdx: 3, query: "" });
  });

  it("captures the partial query between `@` and caret", () => {
    expect(detectMentionTrigger("hi @main", 8)).toEqual({
      atIdx: 3,
      query: "main",
    });
  });

  it("allows queries with spaces (variable names can have them)", () => {
    expect(detectMentionTrigger("hi @main stage", 14)).toEqual({
      atIdx: 3,
      query: "main stage",
    });
  });

  it("closes when caret is after a `[` (user is past the trigger stage)", () => {
    expect(detectMentionTrigger("hi @main[", 9)).toBeNull();
  });

  it("closes when caret is after a `]`", () => {
    expect(detectMentionTrigger("hi @[main]", 10)).toBeNull();
  });

  it("closes when a newline intervenes", () => {
    expect(detectMentionTrigger("hi @main\ntail", 12)).toBeNull();
  });

  it("opens when `@` is at start of string", () => {
    expect(detectMentionTrigger("@bob", 4)).toEqual({ atIdx: 0, query: "bob" });
  });

  it("does NOT open inside `email@[host]` (alnum before `@`)", () => {
    expect(detectMentionTrigger("user@host", 9)).toBeNull();
  });

  it("does NOT open after `@@` (preceding `@` blocks the lookbehind)", () => {
    expect(detectMentionTrigger("@@bob", 5)).toBeNull();
  });

  it("opens after whitespace, punctuation, or start of string", () => {
    expect(detectMentionTrigger(" @bob", 5)?.atIdx).toBe(1);
    expect(detectMentionTrigger(",@bob", 5)?.atIdx).toBe(1);
    expect(detectMentionTrigger("(@bob", 5)?.atIdx).toBe(1);
  });

  it("finds the most recent `@` (later ones win when nested)", () => {
    expect(detectMentionTrigger("a @first b @second", 18)).toEqual({
      atIdx: 11,
      query: "second",
    });
  });
});

// ---------------------------------------------------------------------
// filterVariablesForMention
// ---------------------------------------------------------------------

function v(name: string, kind: VariableState["kind"] = "text"): VariableState {
  return {
    id: name.toLowerCase().replace(/\s/g, "-"),
    name,
    kind,
    number_ref: null,
    aggregate_ref: null,
    default_value_id: null,
    color_index: 0,
    color_hex: null,
    sort_order: 0,
  };
}

describe("filterVariablesForMention", () => {
  const list = [v("Alpha"), v("Beta"), v("Gamma"), v("Alphabet")];

  it("returns all variables alphabetically when query is empty", () => {
    const out = filterVariablesForMention(list, "");
    expect(out.map((x) => x.name)).toEqual([
      "Alpha",
      "Alphabet",
      "Beta",
      "Gamma",
    ]);
  });

  it("ranks prefix matches before substring matches within a group", () => {
    // "al" prefix-matches Alpha + Alphabet; nothing substring-only.
    const out = filterVariablesForMention(list, "al");
    expect(out.map((x) => x.name)).toEqual(["Alpha", "Alphabet"]);
  });

  it("is case-insensitive", () => {
    const out = filterVariablesForMention(list, "GAM");
    expect(out.map((x) => x.name)).toEqual(["Gamma"]);
  });

  it("trims whitespace from the query", () => {
    const out = filterVariablesForMention(list, "  al  ");
    expect(out.map((x) => x.name)).toEqual(["Alpha", "Alphabet"]);
  });

  it("returns an empty array on no matches", () => {
    expect(filterVariablesForMention(list, "zzz")).toEqual([]);
  });

  it("sorts within each tier alphabetically", () => {
    const mixed = [v("Beta"), v("Alpha"), v("Apex"), v("Banana")];
    // prefix on 'a': Alpha, Apex (sorted). substring containing 'a': Beta,
    // Banana (sorted).
    expect(filterVariablesForMention(mixed, "a").map((x) => x.name)).toEqual([
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
    const out = filterVariablesForMention(mixed, "");
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
    const out = filterVariablesForMention(mixed, "er");
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
    const out = filterVariablesForMention(mixed, "er");
    expect(out.map((x) => x.name)).toEqual([
      "Era",
      "Performer",
      "Ergonomics",
    ]);
  });
});
