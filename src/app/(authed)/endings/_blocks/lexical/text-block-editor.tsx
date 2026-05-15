"use client";

// Lexical-based replacement for the textarea body of a text block.
// Renders `@[Name]` tokens as inline pills via MentionNode; serializes
// back to the same plain-text format the DB stores so the evaluator
// keeps working unchanged.

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import type { VariableState } from "@/lib/endings/block-state";
import { cn } from "@/lib/utils";
import { MentionArrowPlugin } from "./mention-arrow-plugin";
import { MentionPastePlugin } from "./mention-paste-plugin";
import { MentionTriggerPlugin } from "./mention-trigger-plugin";
import {
  MentionNode,
  MentionVariablesProvider,
} from "./mention-node";
import {
  buildInitialEditorState,
  buildInitialEditorStateJSON,
  lexicalStateToText,
} from "./serialize";

export interface LexicalTextBlockEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires when the contentEditable gains focus. Used by useInstantField
   *  to broadcast presence focus. */
  onFocus?: () => void;
  /** Fires when the contentEditable loses focus. Used by useInstantField
   *  to flush pending commits before the focus ring leaves. */
  onBlur?: () => void;
  variables: VariableState[];
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
}

export function LexicalTextBlockEditor({
  value,
  onChange,
  onFocus,
  onBlur,
  variables,
  placeholder = "Paragraph text…",
  className,
  style,
}: LexicalTextBlockEditorProps) {
  // The initial editor state is built from `value` exactly once, when
  // LexicalComposer mounts. It is handed to LexicalComposer as a
  // serialized JSON string (not an update function) so Lexical hydrates
  // the content synchronously on mount — without this the editor paints
  // one empty frame and the placeholder flashes through. The init runs
  // BEFORE OnChangePlugin subscribes, so it does NOT trigger a spurious
  // onChange.
  //
  // For live collaboration we ALSO need to push remote `value` updates
  // back into the editor when a peer edits the same block. The
  // ValueSyncPlugin below watches `value` and rebuilds the editor state
  // ONLY when the prop diverges from what we last serialized out —
  // round-trips from our own onChange don't trigger a rebuild.
  const initialEditorState = useMemo(
    () => buildInitialEditorStateJSON(value),
    // Only depend on first-mount value. Subsequent prop changes are
    // routed through ValueSyncPlugin so undo + caret survive when the
    // editor itself is driving the change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Tracks the last text we serialized OUT (either from initial mount
  // or from a previous onChange). ValueSyncPlugin compares incoming
  // `value` against this ref to decide whether to rebuild. Initialised
  // to the first-mount `value` so the immediate post-mount render
  // doesn't trigger a redundant rebuild.
  const lastEmittedRef = useRef<string>(value);

  const initialConfig = useMemo(
    () => ({
      namespace: "ending-text-block",
      editorState: initialEditorState,
      nodes: [MentionNode],
      onError(error: Error) {
        // Surface Lexical errors so they don't get swallowed silently.
        // eslint-disable-next-line no-console
        console.error("[LexicalTextBlockEditor]", error);
      },
      theme: {
        // Minimal — we style the ContentEditable wrapper directly.
        paragraph: "m-0",
      },
    }),
    [initialEditorState]
  );

  const handleChange = useCallback(
    (editorState: import("lexical").EditorState) => {
      const text = lexicalStateToText(editorState);
      lastEmittedRef.current = text;
      onChange(text);
    },
    [onChange]
  );

  return (
    <MentionVariablesProvider variables={variables}>
      <div className="relative" style={style}>
        <LexicalComposer initialConfig={initialConfig}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-label="Text block body"
                onFocus={onFocus}
                onBlur={onBlur}
                className={cn(
                  // Match the textarea's chrome so the swap is visually
                  // invisible at the card level. The ContentEditable
                  // grows with content naturally (no inline-style
                  // height dance), with min-height matching ~2 lines.
                  "min-h-[3rem] w-full rounded-md border border-transparent bg-[var(--block-result-bg)] px-3 py-2 font-mono !text-sm shadow-none outline-none focus:border-border focus-visible:shadow-sm",
                  className
                )}
                style={{ fontVariantLigatures: "none" }}
              />
            }
            placeholder={
              <div className="pointer-events-none absolute left-3 top-2 font-mono !text-sm text-muted-foreground">
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
          <ValueSyncPlugin value={value} lastEmittedRef={lastEmittedRef} />
          <MentionArrowPlugin />
          <MentionPastePlugin />
          <MentionTriggerPlugin variables={variables} />
        </LexicalComposer>
      </div>
    </MentionVariablesProvider>
  );
}

/**
 * Push remote `value` updates into the Lexical editor when they diverge
 * from what the local editor last emitted. Without this, peer edits
 * via the postgres echo arrive in the parent prop but never make it
 * into the editor (Lexical owns its editable state post-mount).
 *
 * The lastEmittedRef guards against an infinite update loop: our own
 * onChange writes to the ref before propagating, so the next render's
 * `value` prop matches lastEmittedRef and we skip the rebuild.
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
    // Update ref BEFORE the editor.update so that the resulting
    // onChange round-trip (Lexical fires its own OnChangePlugin after
    // any state mutation) lands on a matching ref and is treated as
    // an idempotent no-op rather than a fresh edit.
    lastEmittedRef.current = value;
    editor.update(buildInitialEditorState(value));
  }, [value, editor, lastEmittedRef]);
  return null;
}
