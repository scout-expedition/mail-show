"use client";

// Lexical plugin: watches for `@` in the editor's text, opens the
// autocomplete popup at the caret, and commits a MentionNode on
// Enter / Tab / click.
//
// Reuses:
//   - detectMentionTrigger(text, caret) — backwards scan for a valid
//     `@` (same lookbehind as the substitution regex)
//   - MentionAutocompletePopup — the rendered list (props-driven so we
//     can position it at the caret via absolute coords)
// both from `../mention-autocomplete.tsx`, plus the shared
// `filterVariables` kind-grouped filter from the variable-picker module.

import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type TextNode,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { VariableState } from "@/lib/endings/block-state";
import { filterVariables } from "@/components/variable-picker/variable-filter";
import {
  detectMentionTrigger,
  MentionAutocompletePopup,
} from "../mention-autocomplete";
import { $createMentionNode } from "./mention-node";

interface ActiveTrigger {
  /** The Lexical TextNode key that contains the `@` and the query. */
  textNodeKey: string;
  /** Offset of the `@` within that node. */
  atOffset: number;
  /** Current query string (chars between `@` and caret). */
  query: string;
  /** Pixel coords (relative to viewport, then we adjust below) for the
   *  popup anchor. */
  caretRect: { top: number; left: number };
}

export function MentionTriggerPlugin({
  variables,
}: {
  variables: VariableState[];
}) {
  const [editor] = useLexicalComposerContext();
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Reset highlight whenever the query changes — adjust in render.
  const [prevQuery, setPrevQuery] = useState(trigger?.query);
  if (trigger?.query !== prevQuery) {
    setPrevQuery(trigger?.query);
    setActiveIndex(0);
  }

  const filtered = useMemo(
    () => filterVariables(variables, trigger?.query ?? ""),
    [variables, trigger?.query]
  );

  // -----------------------------------------------------------------
  // Trigger detection: re-run on every editor update.
  // -----------------------------------------------------------------
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) {
          setTrigger(null);
          return;
        }
        const anchor = sel.anchor;
        const node = anchor.getNode();
        // Only fire on text nodes; selection inside a decorator skips.
        if (node.getType() !== "text") {
          setTrigger(null);
          return;
        }
        const text = node.getTextContent();
        const caret = anchor.offset;
        const detected = detectMentionTrigger(text, caret);
        if (!detected) {
          setTrigger(null);
          return;
        }
        // Capture the caret's screen rect for popup positioning.
        const domSel = window.getSelection();
        let rect = { top: 0, left: 0 };
        if (domSel && domSel.rangeCount > 0) {
          const r = domSel.getRangeAt(0).getBoundingClientRect();
          // Position below + slightly indented from the caret.
          rect = { top: r.bottom + 4, left: r.left };
        }
        setTrigger({
          textNodeKey: node.getKey(),
          atOffset: detected.atIdx,
          query: detected.query,
          caretRect: rect,
        });
      });
    });
  }, [editor]);

  // -----------------------------------------------------------------
  // Commit: replace the `@query` text run with a MentionNode + a
  // trailing space.
  // -----------------------------------------------------------------
  const commit = useCallback(
    (variable: VariableState) => {
      if (!trigger) return;
      editor.update(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
        const node = $getNodeByKey(trigger.textNodeKey);
        if (!node || !$isTextNode(node)) return;
        const textNode = node as TextNode;
        const caret = sel.anchor.offset;
        // Split the text node into three pieces at [atOffset, caret]:
        // [prefix, queryRun, suffix]. The query run is what the user
        // typed after `@` (e.g. "@mai"); we replace it with a
        // MentionNode + trailing space so the caret can land outside
        // the pill.
        const parts = textNode.splitText(trigger.atOffset, caret);
        // splitText returns up to 3 nodes — the original is in the
        // array. The `query` part (index depending on whether prefix
        // was empty) gets replaced.
        let queryNode: TextNode | null = null;
        if (trigger.atOffset === 0) {
          // Prefix empty → splitText skipped the first split. Node 0 is
          // the query run.
          queryNode = parts[0] ?? null;
        } else {
          queryNode = parts[1] ?? null;
        }
        if (!queryNode) return;
        const mention = $createMentionNode(variable.name);
        const trailingSpace = $createTextNode(" ");
        queryNode.replace(mention);
        mention.insertAfter(trailingSpace);
        trailingSpace.select(1, 1);
      });
      setTrigger(null);
    },
    [editor, trigger]
  );

  // -----------------------------------------------------------------
  // Keyboard interception: only when the popup is open.
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!trigger) return;
    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (filtered.length === 0) return false;
          event?.preventDefault();
          setActiveIndex((i) => (i + 1) % filtered.length);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (filtered.length === 0) return false;
          event?.preventDefault();
          setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (filtered.length === 0) return false;
          event?.preventDefault();
          commit(filtered[activeIndex]);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (filtered.length === 0) return false;
          event?.preventDefault();
          commit(filtered[activeIndex]);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          setTrigger(null);
          return true;
        },
        COMMAND_PRIORITY_LOW
      )
    );
  }, [editor, trigger, filtered, activeIndex, commit]);

  if (!trigger) return null;
  return (
    <MentionAutocompletePopup
      filtered={filtered}
      activeIndex={activeIndex}
      onChangeActiveIndex={setActiveIndex}
      onCommit={commit}
      position={trigger.caretRect}
    />
  );
}
