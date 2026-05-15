"use client";

// Lexical-based replacement for the textarea body of a text block.
// Renders `@[Name]` tokens as inline pills via MentionNode; serializes
// back to the same plain-text format the DB stores so the evaluator
// keeps working unchanged.

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useCallback, useMemo, type CSSProperties } from "react";
import type { VariableState } from "@/lib/endings/block-state";
import { cn } from "@/lib/utils";
import { MentionArrowPlugin } from "./mention-arrow-plugin";
import { MentionPastePlugin } from "./mention-paste-plugin";
import { MentionTriggerPlugin } from "./mention-trigger-plugin";
import {
  MentionNode,
  MentionVariablesProvider,
} from "./mention-node";
import { buildInitialEditorState, lexicalStateToText } from "./serialize";

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
  // LexicalComposer mounts. LexicalComposer's `editorState` config
  // hook runs BEFORE OnChangePlugin subscribes, so this parse does NOT
  // trigger a spurious onChange.
  //
  // If the parent's `value` prop later diverges from the editor's own
  // state (e.g. a hard reset), that's currently NOT reflected — the
  // editor owns its state post-mount. The dirty-flag flow in
  // DocumentEditor calls onChange on every edit, so the parent stays
  // in sync via the down-flow we drive; the parent doesn't push value
  // back into the editor.
  const initialEditorState = useMemo(
    () => buildInitialEditorState(value),
    // Only depend on first-mount value. Intentionally don't react to
    // `value` changes — Lexical owns the editable state and rebuilding
    // it on every prop change would obliterate undo + caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

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
      onChange(lexicalStateToText(editorState));
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
          <MentionArrowPlugin />
          <MentionPastePlugin />
          <MentionTriggerPlugin variables={variables} />
        </LexicalComposer>
      </div>
    </MentionVariablesProvider>
  );
}
