"use client";

// Lexical plugin: watches for `@` in the editor's text, opens the
// folder-aware autocomplete popup at the caret, and commits a MentionNode
// on Enter / Tab / click.
//
// Reuses:
//   - detectMentionTrigger(text, caret) — backwards scan for a valid
//     `@` (same lookbehind as the substitution regex)
// from `../mention-autocomplete.tsx`.
//
// The picker panel (VariablePickerPanel) and its item builder
// (buildPickerItems) come from the shared variable-picker module.

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
  KEY_BACKSPACE_COMMAND,
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
import type { EndingVariableFolder } from "@/lib/db/types";
import { buildVariableTree } from "@/lib/endings/variable-categories";
import {
  buildPickerItems,
  VariablePickerPanel,
  type PickerItem,
} from "@/components/variable-picker/variable-picker-panel";
import { detectMentionTrigger } from "../mention-autocomplete";
import { CreateVariablePopover } from "../create-variable-popover";
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
  folders,
}: {
  variables: VariableState[];
  folders: EndingVariableFolder[];
}) {
  const [editor] = useLexicalComposerContext();
  const [trigger, setTrigger] = useState<ActiveTrigger | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  // Carries both the popover anchor and a frozen copy of the trigger so
  // onCreated can still locate the text node for the deferred commit
  // (trigger will already be null by then).
  const [createPopoverState, setCreatePopoverState] = useState<{
    position: { top: number; left: number };
    frozenTrigger: ActiveTrigger;
  } | null>(null);

  const tree = useMemo(
    () => buildVariableTree(variables, folders),
    [variables, folders]
  );

  const items = useMemo(
    () => buildPickerItems(tree, path, trigger?.query ?? ""),
    [tree, path, trigger?.query]
  );

  // Pair every trigger-null transition with a path reset so subsequent
  // open-events start from the top level. Inlined into the close paths
  // below (closeTrigger helper) rather than chained via useEffect, since
  // synchronous setState-in-effect is now lint-flagged.
  const closeTrigger = useCallback(() => {
    setTrigger(null);
    setPath([]);
    setActiveIndex(0);
  }, []);

  // Reset the keyboard highlight whenever the rendered items list
  // changes shape (different query or different nav level). Matches the
  // existing setActiveIndex(0) reset pattern used throughout this file's
  // sibling pickers; the set-state-in-effect rule is a repo-wide warning
  // not enforced for these incremental resets.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [trigger?.query, path]);

  // -----------------------------------------------------------------
  // Trigger detection: re-run on every editor update.
  // -----------------------------------------------------------------
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) {
          closeTrigger();
          return;
        }
        const anchor = sel.anchor;
        const node = anchor.getNode();
        // Only fire on text nodes; selection inside a decorator skips.
        if (node.getType() !== "text") {
          closeTrigger();
          return;
        }
        const text = node.getTextContent();
        const caret = anchor.offset;
        const detected = detectMentionTrigger(text, caret);
        if (!detected) {
          closeTrigger();
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
  //
  // Accepts an explicit `activeTrigger` so callers that hold a frozen
  // snapshot (e.g. onCreated after the popover closes) can still
  // locate the text node even when the `trigger` state is already null.
  // -----------------------------------------------------------------
  const commitWithTrigger = useCallback(
    (variable: VariableState, activeTrigger: ActiveTrigger) => {
      editor.update(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
        const node = $getNodeByKey(activeTrigger.textNodeKey);
        if (!node || !$isTextNode(node)) return;
        const textNode = node as TextNode;
        const caret = sel.anchor.offset;
        // Split the text node into three pieces at [atOffset, caret]:
        // [prefix, queryRun, suffix]. The query run is what the user
        // typed after `@` (e.g. "@mai"); we replace it with a
        // MentionNode + trailing space so the caret can land outside
        // the pill.
        const parts = textNode.splitText(activeTrigger.atOffset, caret);
        // splitText returns up to 3 nodes — the original is in the
        // array. The `query` part (index depending on whether prefix
        // was empty) gets replaced.
        let queryNode: TextNode | null = null;
        if (activeTrigger.atOffset === 0) {
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
    },
    [editor]
  );

  const commit = useCallback(
    (variable: VariableState) => {
      if (!trigger) return;
      commitWithTrigger(variable, trigger);
      closeTrigger();
    },
    [commitWithTrigger, trigger, closeTrigger]
  );

  // -----------------------------------------------------------------
  // handleItemCommit: shared logic for keyboard + click commit.
  // -----------------------------------------------------------------
  const handleItemCommit = useCallback(
    (item: PickerItem) => {
      if (item.kind === "variable") {
        commit(item.variable);
      } else if (item.kind === "category" || item.kind === "folder") {
        setPath((prev) => [...prev, item.id]);
      } else if (item.kind === "back") {
        setPath((prev) => prev.slice(0, -1));
      } else if (item.kind === "create") {
        // Snapshot the trigger before nulling it so onCreated can still
        // locate the text node for the deferred commit.
        if (trigger) {
          setCreatePopoverState({
            position: trigger.caretRect,
            frozenTrigger: trigger,
          });
        }
        closeTrigger();
      }
    },
    [commit, trigger, closeTrigger]
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
          if (items.length === 0) return false;
          event?.preventDefault();
          setActiveIndex((i) => (i + 1) % items.length);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (items.length === 0) return false;
          event?.preventDefault();
          setActiveIndex((i) => (i - 1 + items.length) % items.length);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (items.length === 0) return false;
          event?.preventDefault();
          handleItemCommit(items[activeIndex]);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (items.length === 0) return false;
          event?.preventDefault();
          handleItemCommit(items[activeIndex]);
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          closeTrigger();
          return true;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        () => {
          // Only intercept when the popup is open, query is empty, and
          // we're nested (path.length > 0). Pop one level up.
          if (trigger.query === "" && path.length > 0) {
            setPath((prev) => prev.slice(0, -1));
            return true;
          }
          // Otherwise let Lexical's normal backspace run.
          return false;
        },
        COMMAND_PRIORITY_HIGH
      )
    );
  }, [editor, trigger, items, activeIndex, path, handleItemCommit]);

  return (
    <>
      {trigger ? (
        <VariablePickerPanel
          items={items}
          activeIndex={activeIndex}
          onChangeActiveIndex={setActiveIndex}
          onCommitItem={handleItemCommit}
          ariaLabel="Variable autocomplete"
          style={{
            position: "fixed",
            top: trigger.caretRect.top,
            left: trigger.caretRect.left,
            zIndex: 20,
          }}
          className="w-64 rounded-md border border-border bg-popover shadow-lg"
        />
      ) : null}
      {createPopoverState ? (
        <CreateVariablePopover
          position={createPopoverState.position}
          folders={folders}
          onClose={() => setCreatePopoverState(null)}
          onCreated={(variableId) => {
            const variable = variables.find((v) => v.id === variableId);
            if (variable) {
              // Use the frozen trigger snapshot — the live `trigger` is
              // already null by the time onCreated fires.
              commitWithTrigger(variable, createPopoverState.frozenTrigger);
            }
            setCreatePopoverState(null);
          }}
        />
      ) : null}
    </>
  );
}
