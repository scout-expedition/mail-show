"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Auto-resizing textarea that shows a markdown-formatting toolbar above the
 * field while it has focus. The toolbar buttons preserve focus via mousedown
 * preventDefault, and mutate the textarea using the native input event so
 * React's onChange pipeline stays in charge of state.
 */
export function MarkdownTextarea({
  value,
  onChange,
  minRows = 6,
  className,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  minRows?: number;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [caretOnFirstLine, setCaretOnFirstLine] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Recompute whether the caret is on the first visual line of the
  // textarea. When it is, the floating toolbar slides down so it
  // doesn't obstruct the text the user is editing.
  function updateCaretPosition() {
    const el = ref.current;
    if (!el) {
      setCaretOnFirstLine(false);
      return;
    }
    // Text before the caret; first line if it has no newline.
    const before = el.value.slice(0, el.selectionStart);
    setCaretOnFirstLine(!before.includes("\n"));
  }

  function fireInput(el: HTMLTextAreaElement, next: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function wrap(before: string, after: string, placeholder: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const insert = selected || placeholder;
    const next = value.slice(0, start) + before + insert + after + value.slice(end);
    const selStart = start + before.length;
    const selEnd = selStart + insert.length;
    fireInput(el, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  function linePrefix(prefix: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = value.slice(0, start);
    const lineStart = before.lastIndexOf("\n") + 1;
    const block = value.slice(lineStart, end);
    const lines = block.length > 0 ? block.split("\n") : [""];
    const prefixed = lines.map((l) => prefix + l).join("\n");
    const next = value.slice(0, lineStart) + prefixed + value.slice(end);
    const addedLen = prefixed.length - block.length;
    fireInput(el, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart + prefix.length, end + addedLen);
    });
  }

  const BTN =
    "inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";

  return (
    <div
      className="relative flex w-full flex-col"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e);
          updateCaretPosition();
        }}
        onKeyUp={updateCaretPosition}
        onClick={updateCaretPosition}
        onSelect={updateCaretPosition}
        onFocus={updateCaretPosition}
        rows={minRows}
        className={cn("resize-none overflow-hidden", className)}
      />
      <div
        className={cn(
          "pointer-events-none absolute right-2 flex items-center gap-0.5 rounded-md border border-border bg-card/95 px-1 py-0.5 shadow-sm backdrop-blur-sm transition-[opacity,top] duration-150",
          focused ? "opacity-100" : "opacity-0",
          // Dodge the caret when it's sitting on the first line so the
          // toolbar isn't hovering over what the user is typing.
          caretOnFirstLine ? "top-9" : "top-2"
        )}
        aria-hidden={!focused}
      >
        <div
          className={cn(
            "flex items-center gap-0.5",
            focused ? "pointer-events-auto" : ""
          )}
        >
          <button
            type="button"
            tabIndex={-1}
            title="Bold"
            aria-label="Bold"
            onMouseDown={(e) => {
              e.preventDefault();
              wrap("**", "**", "bold");
            }}
            className={cn(BTN, "font-bold")}
          >
            B
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Italic"
            aria-label="Italic"
            onMouseDown={(e) => {
              e.preventDefault();
              wrap("*", "*", "italic");
            }}
            className={cn(BTN, "italic")}
          >
            I
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Heading"
            aria-label="Heading"
            onMouseDown={(e) => {
              e.preventDefault();
              linePrefix("## ");
            }}
            className={cn(BTN, "font-semibold")}
          >
            H
          </button>
          <span className="mx-0.5 h-3.5 w-px bg-border" aria-hidden />
          <button
            type="button"
            tabIndex={-1}
            title="Bullet list"
            aria-label="Bullet list"
            onMouseDown={(e) => {
              e.preventDefault();
              linePrefix("- ");
            }}
            className={BTN}
          >
            •
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Numbered list"
            aria-label="Numbered list"
            onMouseDown={(e) => {
              e.preventDefault();
              linePrefix("1. ");
            }}
            className={BTN}
          >
            1.
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Quote"
            aria-label="Quote"
            onMouseDown={(e) => {
              e.preventDefault();
              linePrefix("> ");
            }}
            className={BTN}
          >
            ❝
          </button>
          <span className="mx-0.5 h-3.5 w-px bg-border" aria-hidden />
          <button
            type="button"
            tabIndex={-1}
            title="Inline code"
            aria-label="Inline code"
            onMouseDown={(e) => {
              e.preventDefault();
              wrap("`", "`", "code");
            }}
            className={cn(BTN, "font-mono")}
          >
            {"<>"}
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="Link"
            aria-label="Link"
            onMouseDown={(e) => {
              e.preventDefault();
              wrap("[", "](url)", "text");
            }}
            className={BTN}
          >
            🔗
          </button>
        </div>
      </div>
    </div>
  );
}
