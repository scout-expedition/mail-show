"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export type UnsavedOutcome = "save" | "discard" | "cancel";

const DEFAULT_TITLE = "Unsaved";
const DEFAULT_MESSAGE =
  "Changes will be lost. Would you like to save first?";

/**
 * Tri-state dialog for unsaved changes. Returns "save", "discard", or
 * "cancel". Layout: Discard on the left; Cancel + Save grouped on the
 * right with Save as the default (autofocused) action. Click outside
 * resolves to "cancel".
 */
export function useUnsavedDialog(options?: { scoped?: boolean }): {
  ask: (title?: string, message?: string) => Promise<UnsavedOutcome>;
  dialog: React.ReactNode;
} {
  const scoped = !!options?.scoped;
  const [state, setState] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const resolveRef = useRef<((v: UnsavedOutcome) => void) | null>(null);

  const ask = useCallback(
    (title?: string, message?: string) =>
      new Promise<UnsavedOutcome>((resolve) => {
        resolveRef.current = resolve;
        setState({
          title: title ?? DEFAULT_TITLE,
          message: message ?? DEFAULT_MESSAGE,
        });
      }),
    []
  );

  function settle(v: UnsavedOutcome) {
    const r = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    r?.(v);
  }

  const dialog = state ? (
    <div
      className={
        (scoped ? "absolute" : "fixed") +
        " inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      }
      role="dialog"
      aria-modal="true"
      aria-label={state.title}
      onClick={() => settle("cancel")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-md border border-border bg-card p-6 shadow-xl"
      >
        <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {state.title}
        </h3>
        {state.message ? (
          <p className="mt-3 text-sm text-foreground/90">{state.message}</p>
        ) : null}
        <div className="mt-6 flex items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => settle("discard")}
          >
            Discard
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => settle("cancel")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => settle("save")}
              autoFocus
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, dialog };
}
