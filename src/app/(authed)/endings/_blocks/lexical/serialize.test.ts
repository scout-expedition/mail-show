// Serialization round-trip tests. The `parseTextToParagraphs` helper
// (text → flat paragraph descriptors) is pure and testable without a
// real Lexical editor. The reverse direction (Lexical state → text) is
// covered by the editor-interaction tests in `text-block-editor.test.tsx`
// where it runs against a real editor.

import { describe, expect, it } from "vitest";
import { parseTextToParagraphs } from "./serialize";

describe("parseTextToParagraphs", () => {
  it("returns a single empty paragraph for empty input", () => {
    expect(parseTextToParagraphs("")).toEqual([{ segments: [] }]);
  });

  it("returns one paragraph of plain text", () => {
    expect(parseTextToParagraphs("Hello world.")).toEqual([
      { segments: [{ kind: "text", value: "Hello world." }] },
    ]);
  });

  it("emits a single mention segment for a token-only paragraph", () => {
    expect(parseTextToParagraphs("@[Bob]")).toEqual([
      { segments: [{ kind: "mention", variableName: "Bob" }] },
    ]);
  });

  it("splits text + mention + text segments around a mid-sentence token", () => {
    expect(parseTextToParagraphs("Hi @[Bob], welcome!")).toEqual([
      {
        segments: [
          { kind: "text", value: "Hi " },
          { kind: "mention", variableName: "Bob" },
          { kind: "text", value: ", welcome!" },
        ],
      },
    ]);
  });

  it("emits adjacent mentions with no text segment between", () => {
    expect(parseTextToParagraphs("@[A]@[B]")).toEqual([
      {
        segments: [
          { kind: "mention", variableName: "A" },
          { kind: "mention", variableName: "B" },
        ],
      },
    ]);
  });

  it("handles names with spaces", () => {
    expect(parseTextToParagraphs("Hi @[Mainstage Performer].")).toEqual([
      {
        segments: [
          { kind: "text", value: "Hi " },
          { kind: "mention", variableName: "Mainstage Performer" },
          { kind: "text", value: "." },
        ],
      },
    ]);
  });

  it("splits paragraphs on `\\n`", () => {
    expect(parseTextToParagraphs("Line one.\nLine two.")).toEqual([
      { segments: [{ kind: "text", value: "Line one." }] },
      { segments: [{ kind: "text", value: "Line two." }] },
    ]);
  });

  it("preserves blank paragraphs from consecutive newlines", () => {
    // "a\n\nb" → ["a", "", "b"] — three paragraphs, middle is empty.
    expect(parseTextToParagraphs("a\n\nb")).toEqual([
      { segments: [{ kind: "text", value: "a" }] },
      { segments: [] },
      { segments: [{ kind: "text", value: "b" }] },
    ]);
  });

  it("preserves a leading blank paragraph", () => {
    expect(parseTextToParagraphs("\nhi")).toEqual([
      { segments: [] },
      { segments: [{ kind: "text", value: "hi" }] },
    ]);
  });

  it("preserves a trailing blank paragraph", () => {
    expect(parseTextToParagraphs("hi\n")).toEqual([
      { segments: [{ kind: "text", value: "hi" }] },
      { segments: [] },
    ]);
  });

  it("preserves leading + trailing whitespace inside a paragraph", () => {
    expect(parseTextToParagraphs("  hi  ")).toEqual([
      { segments: [{ kind: "text", value: "  hi  " }] },
    ]);
  });

  it("keeps mention at paragraph edge with no surrounding text", () => {
    expect(parseTextToParagraphs("@[A]\n@[B]")).toEqual([
      { segments: [{ kind: "mention", variableName: "A" }] },
      { segments: [{ kind: "mention", variableName: "B" }] },
    ]);
  });

  it("does not parse `email@[host]` as a mention (lookbehind blocks alnum)", () => {
    expect(parseTextToParagraphs("user@[host.com]")).toEqual([
      { segments: [{ kind: "text", value: "user@[host.com]" }] },
    ]);
  });

  it("does not parse `@@[Name]` as a mention", () => {
    expect(parseTextToParagraphs("@@[Name]")).toEqual([
      { segments: [{ kind: "text", value: "@@[Name]" }] },
    ]);
  });

  it("emits mentions for multiple paragraphs with varied content", () => {
    expect(
      parseTextToParagraphs("Intro.\nHello @[Bob].\n\nFinal @[Score] line.")
    ).toEqual([
      { segments: [{ kind: "text", value: "Intro." }] },
      {
        segments: [
          { kind: "text", value: "Hello " },
          { kind: "mention", variableName: "Bob" },
          { kind: "text", value: "." },
        ],
      },
      { segments: [] },
      {
        segments: [
          { kind: "text", value: "Final " },
          { kind: "mention", variableName: "Score" },
          { kind: "text", value: " line." },
        ],
      },
    ]);
  });
});
