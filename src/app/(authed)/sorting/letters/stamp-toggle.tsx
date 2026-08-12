"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { patchSortingLetter } from "./actions";

/**
 * The stamp on a sorting letter: valid or fake. A two-state button rather than
 * a checkbox, because "checked" carries no meaning here — the column is
 * `stamp_valid`, so true reads as valid and false as a forgery.
 *
 * Flips optimistically and reverts if the write fails; realtime brings peers
 * the same change through the row mirror.
 */
export function StampToggle({
  letterId,
  value,
  onFocus,
  onBlur,
  onError,
}: {
  letterId: string;
  value: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onError?: (message: string) => void;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [, startSave] = useTransition();
  const shown = optimistic ?? value;

  function toggle() {
    const next = !shown;
    setOptimistic(next);
    startSave(async () => {
      try {
        await patchSortingLetter(letterId, { stamp_valid: next });
      } catch (err) {
        setOptimistic(null);
        onError?.(err instanceof Error ? err.message : String(err));
      }
    });
  }

  // Once the server value catches up with the optimistic one, stop overriding.
  if (optimistic != null && optimistic === value) setOptimistic(null);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={shown}
      aria-label="Stamp validity"
      title={shown ? "Stamp is valid — click to mark fake" : "Stamp is fake — click to mark valid"}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cn(
        "inline-flex h-7 items-center justify-center rounded-md border px-2 font-mono text-[11px] uppercase tracking-wider transition-colors",
        shown
          ? "border-success/50 bg-success/15 text-success hover:bg-success/25"
          : "border-destructive/50 bg-destructive/15 text-destructive hover:bg-destructive/25"
      )}
    >
      {shown ? "valid" : "fake"}
    </button>
  );
}
