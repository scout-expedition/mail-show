"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export type SubsetPillOption = { value: string; label: string };

/**
 * Muted toggle-pill picker for the "Random (subset)" result option.
 * Shared by ResultBlock and FallbackBlock — each framework is a pill,
 * gray/muted when unselected and raised when selected. Selecting zero
 * frameworks is allowed but invalid: an amber error (styled like the
 * static-analysis warnings) prompts the author to pick at least one.
 * Frameworks that were deleted but still appear in the stored subset
 * render as warning-styled pills so the author can drop them.
 */
export function SubsetPills({
  frameworks,
  selectedIds,
  onToggle,
}: {
  frameworks: SubsetPillOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const selectedSet = new Set(selectedIds);
  const known = new Set(frameworks.map((f) => f.value));
  const missing = selectedIds.filter((id) => !known.has(id));
  return (
    <div
      className="ml-4 flex flex-wrap gap-1.5 rounded-md p-2"
      style={{ backgroundColor: "var(--block-result-bg)" }}
    >
      {frameworks.length === 0 ? (
        <p className="w-full text-[11px] italic text-muted-foreground">
          No frameworks available.
        </p>
      ) : null}
      {frameworks.length > 0 && selectedIds.length === 0 ? (
        <p className="flex w-full items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[10px] font-mono font-semibold uppercase tracking-widest text-amber-200">
          <AlertTriangle size={10} aria-hidden className="shrink-0" />
          Select at least one framework
        </p>
      ) : null}
      {frameworks.map((f) => {
        const checked = selectedSet.has(f.value);
        return (
          <button
            key={f.value}
            type="button"
            aria-pressed={checked}
            onClick={() => onToggle(f.value)}
            className={cn(
              // `!text-` — globals.css `button { color: inherit; font:
              // inherit }` is unlayered and otherwise beats the utility
              // font size AND text color.
              "max-w-full truncate rounded-full px-2.5 py-1 !text-[11px] uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              checked
                ? "bg-foreground/15 !text-foreground ring-1 ring-border"
                : "bg-muted/40 !text-muted-foreground/35 hover:bg-muted/60 hover:!text-muted-foreground/70"
            )}
          >
            {f.label}
          </button>
        );
      })}
      {missing.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed
          onClick={() => onToggle(id)}
          className="max-w-full truncate rounded-full bg-warning/15 px-2.5 py-1 !text-[11px] uppercase tracking-wide !text-warning-foreground ring-1 ring-warning/40 transition-colors hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          (missing framework: {id})
        </button>
      ))}
    </div>
  );
}
