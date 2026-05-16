// Pure bridge between the Lexical editor state and the value persisted in the
// inspection-letter / report-segment `content` columns.
//
// Storage format is a Lexical editor-state JSON string. Legacy rows still hold
// raw Markdown / plain text — those are detected on load and converted into an
// editor state via @lexical/markdown, so no DB migration is needed. The first
// save of a legacy row rewrites it as JSON.

import { ListItemNode, ListNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  ORDERED_LIST,
  STRIKETHROUGH,
  UNORDERED_LIST,
  type Transformer,
} from "@lexical/markdown";
import {
  $createParagraphNode,
  $getRoot,
  $isParagraphNode,
  createEditor,
  type EditorState,
  type LexicalEditor,
} from "lexical";

/**
 * Node classes the rich-text editor and every headless serializer must
 * register. Bold/italic/underline/strikethrough are plain TextNode formats
 * and need no custom node.
 */
export const RICH_TEXT_NODES = [ListNode, ListItemNode];

/**
 * Markdown transformers used ONLY to convert legacy content the first time it
 * is opened. Element transformers come before text-format transformers, the
 * order `$convertFromMarkdownString` expects.
 *
 * Heading, Code, Link, Quote and inline-code are intentionally excluded: the
 * editor has no button for them, so legacy markup using them degrades to plain
 * text rather than producing nodes with no editing affordance.
 */
export const LEGACY_TRANSFORMERS: Array<Transformer> = [
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
];

function headlessEditor(): LexicalEditor {
  return createEditor({ nodes: RICH_TEXT_NODES, onError: () => {} });
}

/**
 * Replace the editor's content with a Lexical state parsed from legacy
 * Markdown / plain text. `$convertFromMarkdownString` clears and rebuilds the
 * root, so this is safe to run against either a fresh or a populated editor.
 * Newlines are preserved because letter/report bodies were authored in a
 * textarea where every newline was a visible break.
 */
function importLegacy(value: string): void {
  $convertFromMarkdownString(value, LEGACY_TRANSFORMERS, undefined, true);
  if ($getRoot().getChildrenSize() === 0) {
    $getRoot().append($createParagraphNode());
  }
}

/**
 * True when `value` is a stored Lexical editor-state JSON string (vs. legacy
 * Markdown / plain text). A cheap structural prefilter rejects obvious
 * non-JSON, then Lexical itself is the authority: if `parseEditorState`
 * succeeds the string is genuine editor state.
 */
export function isLexicalStateJSON(value: string): boolean {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("{")) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || !("root" in parsed)) {
    return false;
  }
  const root = (parsed as { root: unknown }).root;
  if (
    typeof root !== "object" ||
    root === null ||
    (root as { type?: unknown }).type !== "root" ||
    !Array.isArray((root as { children?: unknown }).children)
  ) {
    return false;
  }

  try {
    headlessEditor().parseEditorState(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialized editor state for `LexicalComposer`'s `editorState` config. Passing
 * a JSON string (rather than an init function) lets Lexical hydrate the content
 * synchronously on mount, so the placeholder never flashes through.
 *
 * Already-JSON values pass through verbatim; legacy values are converted via a
 * throwaway headless editor (no DOM needed).
 */
export function buildInitialEditorStateJSON(value: string): string {
  if (value !== "" && isLexicalStateJSON(value)) return value;

  const editor = headlessEditor();
  editor.update(() => importLegacy(value), { discrete: true });
  return JSON.stringify(editor.getEditorState().toJSON());
}

/**
 * Push `value` into a live editor (used by ValueSyncPlugin for remote/peer
 * updates). JSON values are parsed directly; legacy values run through the
 * Markdown converter.
 */
export function applyValueToEditor(editor: LexicalEditor, value: string): void {
  if (value !== "" && isLexicalStateJSON(value)) {
    editor.setEditorState(editor.parseEditorState(value));
    return;
  }
  editor.update(() => importLegacy(value), { discrete: true });
}

/** Serialize a live editor state to the JSON string stored in the DB. */
export function serializeEditorState(editorState: EditorState): string {
  return JSON.stringify(editorState.toJSON());
}

/**
 * True when the state holds nothing but a single empty paragraph. Callers emit
 * `""` for an empty editor so the surrounding `value || null` collapses the
 * field back to NULL instead of persisting the JSON of an empty document.
 */
export function isEmptyEditorState(editorState: EditorState): boolean {
  let empty = false;
  editorState.read(() => {
    const children = $getRoot().getChildren();
    if (children.length === 0) {
      empty = true;
      return;
    }
    if (children.length === 1) {
      const only = children[0];
      empty = $isParagraphNode(only) && only.getTextContent().length === 0;
    }
  });
  return empty;
}
