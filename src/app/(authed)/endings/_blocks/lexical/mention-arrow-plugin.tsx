"use client";

// Arrow-key handler that makes MentionNode atomic for navigation: a
// single arrow-left/arrow-right press hops past a pill instead of
// landing inside its "between" caret slots (Lexical's default decorator
// behaviour places visible caret stops on both sides of the pill, which
// reads as the caret entering the pill mid-traversal).
//
// Only kicks in for collapsed, unmodified arrow presses — leaves
// shift-select, opt-arrow word jumps, etc. to Lexical's default
// keyboard handling.

import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import { useEffect } from "react";
import { $isMentionNode } from "./mention-node";

export function MentionArrowPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event) => {
          if (event && (event.shiftKey || event.altKey || event.metaKey)) {
            return false;
          }
          const sel = $getSelection();
          if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
          const anchor = sel.anchor;
          const node = anchor.getNode();
          // At the END of a text node, the next caret-stop would land
          // on the left edge of the following pill. Skip past it.
          if (node.getType() === "text") {
            const text = node.getTextContent();
            if (anchor.offset !== text.length) return false;
            const next = node.getNextSibling();
            if (!next || !$isMentionNode(next)) return false;
            event?.preventDefault();
            next.selectNext(0, 0);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        (event) => {
          if (event && (event.shiftKey || event.altKey || event.metaKey)) {
            return false;
          }
          const sel = $getSelection();
          if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
          const anchor = sel.anchor;
          const node = anchor.getNode();
          // At the START of a text node, the previous caret-stop would
          // land on the right edge of the preceding pill. Skip past it.
          if (node.getType() === "text") {
            if (anchor.offset !== 0) return false;
            const prev = node.getPreviousSibling();
            if (!prev || !$isMentionNode(prev)) return false;
            event?.preventDefault();
            prev.selectPrevious(undefined, undefined);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW
      )
    );
  }, [editor]);

  return null;
}
