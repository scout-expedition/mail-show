import { describe, expect, it } from "vitest";
import {
  extractVariableTagNames,
  substituteVariablesToSegments,
} from "./text-substitution";
import type { EvalVariable, PreviewSelections } from "./evaluator";

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

// ---------------------------------------------------------------------
// substituteVariablesToSegments
// ---------------------------------------------------------------------

describe("substituteVariablesToSegments", () => {
  function makeCtx(
    overrides: {
      variables?: EvalVariable[];
      textValueIds?: Record<string, string | null>;
      numbers?: Record<string, number | null>;
      valueLabels?: Record<string, string>;
      aggregates?: Map<string, string | null>;
    } = {}
  ) {
    const variables = overrides.variables ?? [];
    const variableByName = new Map<string, EvalVariable>();
    for (const v of variables) variableByName.set(v.name, v);
    const valuesById = new Map<string, string>(
      Object.entries(overrides.valueLabels ?? {})
    );
    const selections: PreviewSelections = {
      textValueIds: overrides.textValueIds ?? {},
      numbers: overrides.numbers ?? {},
      resolved_aggregates: overrides.aggregates,
    };
    return { variableByName, selections, valuesById };
  }

  const textVar = (id: string, name: string): EvalVariable => ({
    id,
    name,
    kind: "text",
    aggregate_ref: null,
  });

  it("returns a single literal segment when text has no tokens", () => {
    expect(
      substituteVariablesToSegments("Plain prose.", makeCtx())
    ).toEqual([{ kind: "literal", text: "Plain prose." }]);
  });

  it("emits literal + value + literal around a resolved text variable", () => {
    const ctx = makeCtx({
      variables: [textVar("v1", "Bob")],
      textValueIds: { v1: "val-1" },
      valueLabels: { "val-1": "Bob the Performer" },
    });
    expect(
      substituteVariablesToSegments("Hi @[Bob], welcome.", ctx)
    ).toEqual([
      { kind: "literal", text: "Hi " },
      { kind: "value", text: "Bob the Performer", variableName: "Bob" },
      { kind: "literal", text: ", welcome." },
    ]);
  });

  it("emits an `unresolved` segment when the variable name is unknown", () => {
    const ctx = makeCtx({ variables: [textVar("v1", "Bob")] });
    expect(substituteVariablesToSegments("@[Unknown]", ctx)).toEqual([
      { kind: "unresolved", text: "@[Unknown]", variableName: "Unknown" },
    ]);
  });

  it("emits an `unresolved` segment when the text variable has no selection", () => {
    const ctx = makeCtx({
      variables: [textVar("v1", "Bob")],
      textValueIds: { v1: null },
      valueLabels: { "val-1": "Bob" },
    });
    expect(substituteVariablesToSegments("Hi @[Bob].", ctx)).toEqual([
      { kind: "literal", text: "Hi " },
      { kind: "unresolved", text: "@[Bob]", variableName: "Bob" },
      { kind: "literal", text: "." },
    ]);
  });

  it("handles multiple tokens with mixed resolution states", () => {
    const ctx = makeCtx({
      variables: [textVar("v1", "A"), textVar("v2", "B")],
      textValueIds: { v1: "val-a", v2: null },
      valueLabels: { "val-a": "alpha" },
    });
    expect(
      substituteVariablesToSegments("@[A] and @[B] and @[C]", ctx)
    ).toEqual([
      { kind: "value", text: "alpha", variableName: "A" },
      { kind: "literal", text: " and " },
      { kind: "unresolved", text: "@[B]", variableName: "B" },
      { kind: "literal", text: " and " },
      { kind: "unresolved", text: "@[C]", variableName: "C" },
    ]);
  });
});
