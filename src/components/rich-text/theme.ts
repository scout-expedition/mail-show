// Shared Lexical theme for the rich-text editor and its read-only renderer.
// Tailwind v4's preflight strips list markers, so every styled node type is
// mapped back to explicit utility classes here.

import type { EditorThemeClasses } from "lexical";

export const RICH_TEXT_THEME: EditorThemeClasses = {
  paragraph: "m-0 mb-1 last:mb-0",
  list: {
    ul: "my-1 ml-5 list-disc",
    ol: "my-1 ml-5 list-decimal",
    listitem: "my-0.5",
    // Lexical wraps a nested list inside its parent <li>; drop that wrapper's
    // marker so only the real items show one.
    nested: { listitem: "list-none" },
  },
  text: {
    bold: "font-black",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    // Lexical emits this single class when a node is both underlined and
    // struck through — one declaration carries both decorations.
    underlineStrikethrough: "[text-decoration-line:underline_line-through]",
  },
};
