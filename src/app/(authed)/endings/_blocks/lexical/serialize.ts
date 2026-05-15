// Pure-function bridge between the Lexical editor state and the plain
// `@[Name]` text format stored in `ending_blocks.text`.
//
// On editor mount, we parse the DB string into a list of paragraph
// descriptors that the editor consumes via LexicalComposer's
// `initialEditorState` (which fires BEFORE OnChangePlugin subscribes,
// so the initial parse doesn't dirty the doc).
//
// On every editor change, we walk the editor state and produce the
// canonical `@[Name]` plain-text representation. The walker is fully
// custom — Lexical's default `getTextContent()` on root would join
// paragraphs with `\n\n` in some configurations, which would silently
// change saved content.

import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { TOKEN_RE } from "@/lib/endings/text-substitution";
import {
  $createMentionNode,
  $isMentionNode,
  MentionNode,
} from "./mention-node";

// ---------------------------------------------------------------------
// Parse: plain text → Lexical nodes
// ---------------------------------------------------------------------

/** Inline segment of a paragraph. Either a literal text run or a
 *  variable mention. */
export type InlineSegment =
  | { kind: "text"; value: string }
  | { kind: "mention"; variableName: string };

/** Paragraph = a `\n`-separated chunk of the source string. Each holds
 *  a flat list of inline segments. Empty paragraphs (blank lines)
 *  produce a paragraph with an empty segments array. */
export interface ParsedParagraph {
  segments: InlineSegment[];
}

export function parseTextToParagraphs(text: string): ParsedParagraph[] {
  // Split on `\n` first so each paragraph is independent. Empty strings
  // (blank lines, leading/trailing newlines) become empty paragraphs.
  const lines = text.split("\n");
  return lines.map((line) => ({ segments: parseLineSegments(line) }));
}

function parseLineSegments(line: string): InlineSegment[] {
  if (line === "") return [];
  const segments: InlineSegment[] = [];
  let cursor = 0;
  // Reset regex state since TOKEN_RE has the global flag.
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "text", value: line.slice(cursor, match.index) });
    }
    segments.push({ kind: "mention", variableName: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length) {
    segments.push({ kind: "text", value: line.slice(cursor) });
  }
  return segments;
}

/**
 * Build the editor's initial state from a plain-text body. Returns a
 * function suitable for LexicalComposer's `initialEditorState` config,
 * which Lexical invokes via `editor.update` before `OnChangePlugin`
 * subscribes — so the parse does NOT trigger a spurious onChange.
 */
export function buildInitialEditorState(text: string) {
  return () => {
    const root = $getRoot();
    root.clear();
    const paragraphs = parseTextToParagraphs(text);
    for (const para of paragraphs) {
      const paragraphNode = $createParagraphNode();
      for (const seg of para.segments) {
        if (seg.kind === "text") {
          paragraphNode.append($createTextNode(seg.value));
        } else {
          paragraphNode.append($createMentionNode(seg.variableName));
        }
      }
      root.append(paragraphNode);
    }
    // Edge case: an entirely empty `text` produces zero paragraphs.
    // The editor needs at least one paragraph or it crashes on focus.
    if (root.getChildrenSize() === 0) {
      root.append($createParagraphNode());
    }
  };
}

/**
 * Serialized editor state for `LexicalComposer`'s `editorState` config.
 *
 * Handing `LexicalComposer` a JSON string (rather than the update
 * function from `buildInitialEditorState`) lets Lexical hydrate the
 * editor synchronously on mount: the content is present on the very
 * first paint, so the placeholder never flashes through the empty
 * editor for a frame. The state is built once via a throwaway headless
 * editor — no DOM is needed for serialization.
 */
export function buildInitialEditorStateJSON(text: string): string {
  const editor = createEditor({ nodes: [MentionNode], onError: () => {} });
  editor.update(buildInitialEditorState(text), { discrete: true });
  return JSON.stringify(editor.getEditorState().toJSON());
}

// ---------------------------------------------------------------------
// Serialize: Lexical state → plain text
// ---------------------------------------------------------------------

/**
 * Walk the editor state and produce the canonical `@[Name]` text. This
 * is the single source of truth for what gets written back to the DB.
 *
 * Rules:
 *  - Paragraphs join with `\n` (single newline, matches today's
 *    textarea behavior).
 *  - Text nodes emit their raw `getTextContent()` verbatim.
 *  - Mention nodes emit `@[variableName]`.
 *  - Other node types (shouldn't appear in our editor, but defensive)
 *    fall through to `getTextContent()`.
 */
export function lexicalStateToText(editorState: EditorState): string {
  let out = "";
  editorState.read(() => {
    const root = $getRoot();
    const paragraphs = root.getChildren();
    const parts: string[] = [];
    for (const para of paragraphs) {
      const children = (para as ReturnType<typeof $getRoot>).getChildren?.()
        ?? [];
      const lineParts: string[] = [];
      for (const child of children) {
        if ($isMentionNode(child)) {
          lineParts.push(`@[${(child as MentionNode).getVariableName()}]`);
        } else {
          lineParts.push(child.getTextContent());
        }
      }
      parts.push(lineParts.join(""));
    }
    out = parts.join("\n");
  });
  return out;
}

/** Convenience wrapper for callers that have an editor instance. */
export function editorToText(editor: LexicalEditor): string {
  return lexicalStateToText(editor.getEditorState());
}
