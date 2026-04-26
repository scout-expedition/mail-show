"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Intent = "destructive" | "default";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: Intent;
};

/**
 * Custom overlay confirmation dialog. Returns a `confirm(options)` function
 * that resolves to `true` or `false`, and a `<ConfirmDialog />` element to
 * mount once anywhere in the subtree.
 */
export function useConfirm(options?: { scoped?: boolean }): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const scoped = !!options?.scoped;
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState(options);
    });
  }, []);

  function settle(value: boolean) {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    resolver?.(value);
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
      onClick={() => settle(false)}
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
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => settle(false)}
            autoFocus
          >
            {state.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={state.intent === "destructive" ? "destructive" : "default"}
            onClick={() => settle(true)}
            className={cn(
              state.intent === "destructive" &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
          >
            {state.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
