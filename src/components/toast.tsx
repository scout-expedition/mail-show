"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ToastIntent = "default" | "destructive" | "success";

export type ToastOptions = {
  /** Short message shown on a single line. */
  message: string;
  /** Optional accent. Default "default". */
  intent?: ToastIntent;
  /** Auto-dismiss timeout in ms. Default 4000. */
  durationMs?: number;
};

type Toast = ToastOptions & { id: number };

const MAX_VISIBLE = 5;

/**
 * Minimal in-tree toast hook. Returns `toast(options)` and a `toaster` node
 * to mount once anywhere in the subtree. Matches the `useConfirm` pattern.
 *
 * Toasts stack vertically (newest on top), auto-dismiss after `durationMs`,
 * and the queue is capped at `MAX_VISIBLE` — older entries are evicted as
 * new ones arrive.
 */
export function useToast(): {
  toast: (options: ToastOptions) => void;
  toaster: React.ReactNode;
} {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    const id = nextIdRef.current++;
    setToasts((t) => {
      const next: Toast = { ...options, id };
      const combined = [next, ...t];
      return combined.slice(0, MAX_VISIBLE);
    });
  }, []);

  const toaster = (
    <div
      className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );

  return { toast, toaster };
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const duration = toast.durationMs ?? 4000;
    const handle = setTimeout(onDismiss, duration);
    return () => clearTimeout(handle);
  }, [toast.durationMs, onDismiss]);

  const accent =
    toast.intent === "destructive"
      ? "border-destructive/60 bg-destructive/10"
      : toast.intent === "success"
        ? "border-emerald-500/60 bg-emerald-500/10"
        : "border-border bg-card";

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur-sm",
        accent
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="leading-snug">{toast.message}</span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          ×
        </button>
      </div>
    </div>
  );
}
