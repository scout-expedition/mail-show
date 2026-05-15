import { describe, expect, it } from "vitest";
import { detectMentionTrigger } from "./mention-autocomplete";

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

// The kind-grouped variable filter moved to the shared variable-picker
// module — its tests now live in
// `src/components/variable-picker/variable-filter.test.ts`.
