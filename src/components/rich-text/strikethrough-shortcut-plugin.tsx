"use client";

// Lexical's rich-text already binds Cmd/Ctrl+B/I/U (the browser emits native
// `formatBold`/`formatItalic`/`formatUnderline` input events for those). There
// is no native shortcut for strikethrough, so this plugin wires Cmd/Ctrl+Shift+S
// to the strikethrough text format.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_NORMAL,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
} from "lexical";
import { useEffect } from "react";

export function StrikethroughShortcutPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL,
    );
  }, [editor]);

  return null;
}
