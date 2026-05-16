// Serialization tests for the rich-text content bridge. Everything here is
// pure: `isLexicalStateJSON`, `buildInitialEditorStateJSON`,
// `serializeEditorState` and `isEmptyEditorState` run against headless
// `createEditor` instances with no DOM. The live-editor paths
// (`applyValueToEditor`, ValueSyncPlugin) are covered in
// `rich-text-editor.test.tsx` where a real editor exists.

import { $getRoot, $isTextNode, createEditor, type ElementNode } from "lexical";
import { describe, expect, it } from "vitest";
import {
  buildInitialEditorStateJSON,
  isEmptyEditorState,
  isLexicalStateJSON,
  RICH_TEXT_NODES,
  serializeEditorState,
} from "./serialize";

// Headless editor matching the one the module builds internally — used to
// parse JSON strings back into states for inspection.
function headless() {
  return createEditor({ nodes: RICH_TEXT_NODES, onError: () => {} });
}

// A genuine stored Lexical state: the JSON of an editor seeded with prose.
function realStateJSON(prose = "Hello world."): string {
  return buildInitialEditorStateJSON(prose);
}

describe("isLexicalStateJSON", () => {
  it("should return true for a genuine serialized editor state", () => {
    expect(isLexicalStateJSON(realStateJSON())).toBe(true);
  });

  it("should return false for plain prose", () => {
    expect(isLexicalStateJSON("Just some plain prose.")).toBe(false);
  });

  it("should return false for legacy Markdown", () => {
    expect(isLexicalStateJSON("**bold** text")).toBe(false);
  });

  it("should return false for an empty string", () => {
    expect(isLexicalStateJSON("")).toBe(false);
  });

  it("should return false for prose that merely starts with a brace", () => {
    expect(isLexicalStateJSON("{ this is not json at all")).toBe(false);
  });

  it("should return false for the permissive near-miss with no children array", () => {
    // Passes the structural type/root check but `root.children` is absent, so
    // the prefilter must still reject it before reaching parseEditorState.
    expect(isLexicalStateJSON('{"root":{"type":"root"}}')).toBe(false);
  });
});

describe("buildInitialEditorStateJSON", () => {
  it("should return an already-Lexical value verbatim", () => {
    const stored = realStateJSON("Existing content.");
    expect(buildInitialEditorStateJSON(stored)).toBe(stored);
  });

  it("should produce parseable JSON for legacy plain text", () => {
    const json = buildInitialEditorStateJSON("Some legacy prose.");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("should convert legacy '**bold**' into a bold-formatted text node", () => {
    const json = buildInitialEditorStateJSON("**bold**");
    const state = headless().parseEditorState(json);
    let hasBoldText = false;
    state.read(() => {
      const walk = (node: ElementNode) => {
        for (const child of node.getChildren()) {
          if ($isTextNode(child) && child.hasFormat("bold")) {
            hasBoldText = true;
          } else if (typeof (child as ElementNode).getChildren === "function") {
            walk(child as ElementNode);
          }
        }
      };
      walk($getRoot());
    });
    expect(hasBoldText).toBe(true);
  });

  it("should not crash on legacy plain text with stray markdown characters", () => {
    expect(() =>
      buildInitialEditorStateJSON("a lone * and an _ floating here"),
    ).not.toThrow();
  });

  it("should yield a single empty paragraph for an empty string", () => {
    const json = buildInitialEditorStateJSON("");
    const state = headless().parseEditorState(json);
    expect(isEmptyEditorState(state)).toBe(true);
  });
});

describe("isEmptyEditorState", () => {
  it("should return true for a freshly-built empty state", () => {
    const state = headless().parseEditorState(buildInitialEditorStateJSON(""));
    expect(isEmptyEditorState(state)).toBe(true);
  });

  it("should return false for a state containing text", () => {
    const state = headless().parseEditorState(
      buildInitialEditorStateJSON("Not empty."),
    );
    expect(isEmptyEditorState(state)).toBe(false);
  });
});

describe("serializeEditorState — round-trip stability", () => {
  // The ValueSyncPlugin loop-guard depends on a serialized state being
  // byte-stable across parse → serialize: when the editor echoes its own
  // value back through onChange, that echo must equal what was pushed in,
  // otherwise ValueSyncPlugin would rebuild forever.
  it("should be byte-stable for prose content", () => {
    const stored = realStateJSON("Stable content here.");
    const reSerialized = serializeEditorState(
      headless().parseEditorState(stored),
    );
    expect(reSerialized).toBe(stored);
  });

  it("should be byte-stable for an empty state", () => {
    const stored = buildInitialEditorStateJSON("");
    const reSerialized = serializeEditorState(
      headless().parseEditorState(stored),
    );
    expect(reSerialized).toBe(stored);
  });
});
