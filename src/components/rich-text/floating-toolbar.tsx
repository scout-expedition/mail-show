"use client";

// Floating formatting toolbar for RichTextEditor. Mirrors the chrome and
// caret-dodge behaviour of the old MarkdownTextarea toolbar, but drives Lexical
// commands instead of splicing raw Markdown into a textarea. Buttons preserve
// editor focus via `onMouseDown` preventDefault and reflect the active
// formatting of the current selection.

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  FORMAT_TEXT_COMMAND,
  type TextFormatType,
} from "lexical";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type BlockType = "paragraph" | "bullet" | "number";

interface ActiveState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  blockType: BlockType;
}

const INITIAL_ACTIVE: ActiveState = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  blockType: "paragraph",
};

const BTN =
  "inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";
const BTN_ACTIVE = "bg-accent text-foreground";

export function FloatingToolbar() {
  const [editor] = useLexicalComposerContext();
  const [focused, setFocused] = useState(false);
  const [caretOnFirstLine, setCaretOnFirstLine] = useState(false);
  const [active, setActive] = useState<ActiveState>(INITIAL_ACTIVE);

  // Slide the toolbar down when the caret sits near the top of the field so it
  // doesn't hover over the text being edited.
  const syncCaretDodge = useCallback(() => {
    const root = editor.getRootElement();
    const domSel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!root || !domSel || domSel.rangeCount === 0) return;
    const range = domSel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return;
    let rect = range.getBoundingClientRect();
    // A collapsed caret in an empty block can report a zero rect.
    if (rect.height === 0 && rect.top === 0) rect = root.getBoundingClientRect();
    setCaretOnFirstLine(rect.top - root.getBoundingClientRect().top < 24);
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          setFocused(true);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          setFocused(false);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const anchorNode = selection.anchor.getNode();
          const listNode = $getNearestNodeOfType(anchorNode, ListNode);
          let blockType: BlockType = "paragraph";
          if (listNode) {
            blockType =
              listNode.getListType() === "number" ? "number" : "bullet";
          }
          setActive({
            bold: selection.hasFormat("bold"),
            italic: selection.hasFormat("italic"),
            underline: selection.hasFormat("underline"),
            strikethrough: selection.hasFormat("strikethrough"),
            blockType,
          });
        });
        syncCaretDodge();
      }),
    );
  }, [editor, syncCaretDodge]);

  const formatText = (format: TextFormatType) => () =>
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);

  const toggleList = (type: "bullet" | "number") => () => {
    if (active.blockType === type) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(
        type === "number"
          ? INSERT_ORDERED_LIST_COMMAND
          : INSERT_UNORDERED_LIST_COMMAND,
        undefined,
      );
    }
  };

  return (
    <div
      className={cn(
        "pointer-events-none absolute right-2 flex items-center gap-0.5 rounded-md border border-border bg-card/95 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-[opacity,top] duration-150",
        focused ? "opacity-100" : "opacity-0",
        caretOnFirstLine ? "top-9" : "top-2",
      )}
      aria-hidden={!focused}
    >
      <div
        className={cn(
          "flex items-center gap-0.5",
          focused && "pointer-events-auto",
        )}
      >
        <ToolbarButton
          label="Bold"
          active={active.bold}
          className="font-bold"
          onTrigger={formatText("bold")}
        >
          B
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={active.italic}
          className="italic"
          onTrigger={formatText("italic")}
        >
          I
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          active={active.underline}
          className="underline"
          onTrigger={formatText("underline")}
        >
          U
        </ToolbarButton>
        <ToolbarButton
          label="Strikethrough"
          active={active.strikethrough}
          className="line-through"
          onTrigger={formatText("strikethrough")}
        >
          S
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          label="Bullet list"
          active={active.blockType === "bullet"}
          onTrigger={toggleList("bullet")}
        >
          •
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={active.blockType === "number"}
          onTrigger={toggleList("number")}
        >
          1.
        </ToolbarButton>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-3.5 w-px bg-border" aria-hidden />;
}

function ToolbarButton({
  label,
  active,
  className,
  onTrigger,
  children,
}: {
  label: string;
  active: boolean;
  className?: string;
  onTrigger: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => {
        // Keep the selection/focus inside the editor.
        e.preventDefault();
        onTrigger();
      }}
      className={cn(BTN, className, active && BTN_ACTIVE)}
    >
      {children}
    </button>
  );
}
