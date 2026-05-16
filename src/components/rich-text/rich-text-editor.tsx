"use client";

// WYSIWYG rich-text editor for inspection-letter and report-segment content.
// Replaces the old MarkdownTextarea: formatting renders styled instead of as
// raw Markdown markers. Modelled on the endings text-block Lexical editor
// (src/app/(authed)/endings/_blocks/lexical/) — same flash-free hydration and
// ValueSyncPlugin live-collaboration guard.

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import type { EditorState } from "lexical";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import { cn } from "@/lib/utils";
import { FloatingToolbar } from "./floating-toolbar";
import {
  applyValueToEditor,
  buildInitialEditorStateJSON,
  isEmptyEditorState,
  RICH_TEXT_NODES,
  serializeEditorState,
} from "./serialize";
import { StrikethroughShortcutPlugin } from "./strikethrough-shortcut-plugin";
import { RICH_TEXT_THEME } from "./theme";

export interface RichTextEditorProps {
  /** Stored content: Lexical editor-state JSON, or legacy Markdown/plain text. */
  value: string | null | undefined;
  /** Receives the serialized editor state, or `""` when the editor is empty. */
  onChange: (next: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  minRows?: number;
  placeholder?: string;
  className?: string;
}

export function RichTextEditor({
  value,
  onChange,
  onFocus,
  onBlur,
  minRows = 6,
  placeholder = "Write content…",
  className,
}: RichTextEditorProps) {
  const text = value ?? "";

  // The initial state is built from `value` exactly once, on mount, and handed
  // to LexicalComposer as a JSON string so the content hydrates synchronously
  // (no placeholder flash). Subsequent prop changes route through
  // ValueSyncPlugin so undo history + caret survive local edits.
  const initialEditorState = useMemo(
    () => buildInitialEditorStateJSON(text),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Tracks the last string we emitted (or hydrated from). ValueSyncPlugin
  // compares incoming `value` against it to decide whether to rebuild — our
  // own onChange round-trips match and are skipped.
  const lastEmittedRef = useRef<string>(text);

  const initialConfig = useMemo(
    () => ({
      namespace: "rich-text-content",
      editorState: initialEditorState,
      nodes: RICH_TEXT_NODES,
      theme: RICH_TEXT_THEME,
      onError(error: Error) {
        console.error("[RichTextEditor]", error);
      },
    }),
    [initialEditorState],
  );

  const handleChange = useCallback(
    (editorState: EditorState) => {
      // An emptied editor emits "" so the caller's `value || null` collapses
      // the field back to NULL instead of persisting an empty document.
      const next = isEmptyEditorState(editorState)
        ? ""
        : serializeEditorState(editorState);
      lastEmittedRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  return (
    <div className="relative flex w-full flex-col">
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label="Content"
              onFocus={onFocus}
              onBlur={onBlur}
              spellCheck
              className={cn(
                "w-full cursor-text whitespace-pre-wrap break-words rounded-md border px-3 py-2 outline-none",
                className,
              )}
              style={{ minHeight: `${minRows * 1.5}rem` }}
            />
          }
          placeholder={
            <div className="pointer-events-none absolute left-3 top-2 text-xs text-muted-foreground/40">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin
          onChange={handleChange}
          ignoreSelectionChange
          ignoreHistoryMergeTagChange
        />
        <ValueSyncPlugin value={text} lastEmittedRef={lastEmittedRef} />
        <HistoryPlugin />
        <ListPlugin />
        <StrikethroughShortcutPlugin />
        <FloatingToolbar />
      </LexicalComposer>
    </div>
  );
}

/**
 * Pushes remote `value` updates into the editor when they diverge from what
 * the editor last emitted — needed for the live-collaborative `useInstantField`
 * surface. `lastEmittedRef` is updated to the incoming `value` BEFORE the
 * rebuild so the resulting onChange round-trip is recognised as a no-op rather
 * than looping.
 */
function ValueSyncPlugin({
  value,
  lastEmittedRef,
}: {
  value: string;
  lastEmittedRef: MutableRefObject<string>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    applyValueToEditor(editor, value);
  }, [value, editor, lastEmittedRef]);
  return null;
}
