"use client";

// Read-only renderer for stored rich-text content. Used where content is shown
// but not edited (e.g. the Top-of-Day report view). Reuses the editor's node
// set and theme so styled output matches the editor exactly.

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buildInitialEditorStateJSON, RICH_TEXT_NODES } from "./serialize";
import { RICH_TEXT_THEME } from "./theme";

export interface RichTextReadonlyProps {
  /** Stored content: Lexical editor-state JSON, or legacy Markdown/plain text. */
  value: string | null | undefined;
  /** Applied to the wrapping element for both the content and empty states. */
  className?: string;
  /** Rendered when `value` is empty/null. */
  emptyFallback?: ReactNode;
}

export function RichTextReadonly({
  value,
  className,
  emptyFallback,
}: RichTextReadonlyProps) {
  const text = value ?? "";
  const isEmpty = text.trim() === "";

  const initialConfig = useMemo(
    () => ({
      namespace: "rich-text-readonly",
      editable: false,
      editorState: buildInitialEditorStateJSON(text),
      nodes: RICH_TEXT_NODES,
      theme: RICH_TEXT_THEME,
      onError(error: Error) {
        console.error("[RichTextReadonly]", error);
      },
    }),
    [text],
  );

  if (isEmpty) {
    return <div className={className}>{emptyFallback}</div>;
  }

  return (
    <div className={className}>
      {/* Keyed on `text` so a changed value remounts with fresh content —
          LexicalComposer only reads `initialConfig` once. */}
      <LexicalComposer key={text} initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className={cn("whitespace-pre-wrap break-words outline-none")}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </LexicalComposer>
    </div>
  );
}
