"use client";

// Paste handler: when pasted plain text contains `@[Name]` tokens,
// convert each to a MentionNode in place so the user sees pills instead
// of literal text. Falls through to Lexical's default paste behavior
// when no tokens are present — we don't want to interfere with regular
// paragraph/text handling.
//
// In-editor copy-paste (between two text blocks in the same session)
// uses Lexical's custom `application/x-lexical-editor` MIME, which
// already round-trips MentionNodes correctly via `clone` / `importJSON`.
// This handler is for cross-editor / cross-app paste where the only
// signal we have is the `text/plain` payload containing `@[Name]`
// strings.

import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  PASTE_COMMAND,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { TOKEN_RE } from "@/lib/endings/text-substitution";
import { $createMentionNode } from "./mention-node";

export function MentionPastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent | InputEvent | null) => {
        // Duck-type on `clipboardData` — `instanceof ClipboardEvent`
        // is unreliable across environments (jsdom 29 doesn't define
        // the constructor, so it always fails) and we only need the
        // clipboardData payload itself.
        const cb = (event as { clipboardData?: DataTransfer } | null)
          ?.clipboardData;
        if (!cb) return false;
        // Lexical's own clipboard format wins for in-editor paste —
        // don't override it; node round-trip handles MentionNodes
        // natively.
        if (cb.getData("application/x-lexical-editor")) return false;
        const text = cb.getData("text/plain");
        if (!text) return false;
        const re = new RegExp(TOKEN_RE.source, "g");
        if (!re.test(text)) return false; // no tokens → Lexical's default

        event?.preventDefault();
        editor.update(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          // Replace whatever the user has selected (collapsed or
          // ranged) with the parsed nodes.
          sel.removeText();
          const lines = text.split("\n");
          lines.forEach((line, idx) => {
            if (idx > 0) {
              // Each subsequent line becomes a new paragraph.
              sel.insertParagraph();
            }
            const lineRe = new RegExp(TOKEN_RE.source, "g");
            let cursor = 0;
            let match: RegExpExecArray | null;
            while ((match = lineRe.exec(line)) !== null) {
              if (match.index > cursor) {
                sel.insertNodes([
                  $createTextNode(line.slice(cursor, match.index)),
                ]);
              }
              sel.insertNodes([$createMentionNode(match[1])]);
              cursor = match.index + match[0].length;
            }
            if (cursor < line.length) {
              sel.insertNodes([$createTextNode(line.slice(cursor))]);
            }
          });
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    );
  }, [editor]);

  return null;
}
