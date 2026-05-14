import { describe, expect, it } from "vitest";
import { extractVariableTagNames } from "./text-substitution";

// `substituteVariables` is exercised end-to-end through `evaluateFramework`
// in `evaluator.test.ts` (search "text substitution: @[Name]"). These
// direct tests cover `extractVariableTagNames`, which `DocumentEditor`
// consumes independently to surface inputs for variables tagged only in
// text blocks.

describe("extractVariableTagNames", () => {
  it("returns an empty array when the text contains no tokens", () => {
    expect(extractVariableTagNames("Plain prose, no tokens.")).toEqual([]);
  });

  it("returns the captured name for a single token", () => {
    expect(extractVariableTagNames("Hi @[Bob].")).toEqual(["Bob"]);
  });

  it("returns multiple names in document order", () => {
    expect(
      extractVariableTagNames("First: @[Alpha], second: @[Bravo].")
    ).toEqual(["Alpha", "Bravo"]);
  });

  it("returns adjacent token names", () => {
    expect(extractVariableTagNames("@[A]@[B]")).toEqual(["A", "B"]);
  });

  it("returns duplicates as separate entries — caller dedups", () => {
    // The function reports every occurrence so callers can count usage.
    // DocumentEditor's referencedVariables Set-dedups by id naturally.
    expect(extractVariableTagNames("@[X] then @[X] again")).toEqual([
      "X",
      "X",
    ]);
  });

  it("handles names with spaces and punctuation", () => {
    expect(extractVariableTagNames("Welcome to @[City of Brass]!")).toEqual([
      "City of Brass",
    ]);
  });

  it("skips email-like `user@[host]` (negative lookbehind)", () => {
    expect(
      extractVariableTagNames("Email user@[host.com] for info.")
    ).toEqual([]);
  });

  it("skips `@@[Name]` (double-at)", () => {
    expect(extractVariableTagNames("Literal @@[Name] stays.")).toEqual([]);
  });

  it("skips empty brackets @[]", () => {
    expect(extractVariableTagNames("Empty @[] token.")).toEqual([]);
  });

  it("captures only up to the first `]` on nested brackets", () => {
    // `@[Foo[Bar]]` matches `@[Foo[Bar]` capturing `Foo[Bar`. That's
    // intentional — names containing `]` aren't supported (see comment
    // on TOKEN_RE).
    expect(extractVariableTagNames("@[Foo[Bar]]")).toEqual(["Foo[Bar"]);
  });

  it("matches across newlines", () => {
    expect(
      extractVariableTagNames("Line one @[A].\nLine two @[B].")
    ).toEqual(["A", "B"]);
  });

  it("allows tokens after punctuation (the lookbehind only blocks alnum + @)", () => {
    expect(extractVariableTagNames("Hello, @[Bob]!")).toEqual(["Bob"]);
    expect(extractVariableTagNames("(@[Bob])")).toEqual(["Bob"]);
    expect(extractVariableTagNames(".@[Bob]")).toEqual(["Bob"]);
  });
});
