"use client";

import { Archive } from "lucide-react";
import { cn } from "@/lib/utils";

const SLOT_REPORTING = "reporting";

function slotLabel(slot: number | null, reporting: boolean): string {
  if (reporting) return "R";
  if (slot != null) return String(slot);
  return "—";
}

/** Per-size class bundles. `sm` is the list-row variant; `md` matches the
 *  Color swatch height in the inspection panel so the two controls line up. */
const SIZE_CLASSES = {
  sm: { square: "h-5 w-5", text: "text-[10px]", icon: 11 },
  md: { square: "h-7 w-7", text: "text-xs", icon: 14 },
} as const;
type SlotPillSize = keyof typeof SIZE_CLASSES;

/**
 * Two-square pill: a filled mailbox icon (left, knockout — the icon shows
 * the page background through a solid fill) joined to an outlined slot
 * number / "R" for Reporting / "—" for unset (right). Read-only — the panel
 * uses {@link SlotPillSelect} for the editable variant.
 */
export function SlotPill({
  slot,
  reporting,
  size = "sm",
  className,
}: {
  slot: number | null;
  reporting: boolean;
  size?: SlotPillSize;
  className?: string;
}) {
  const sz = SIZE_CLASSES[size];
  return (
    <span
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded border border-muted-foreground font-mono",
        sz.text,
        className
      )}
      aria-label={
        reporting
          ? "Routes to reporting"
          : slot != null
            ? `Delivery slot ${slot}`
            : "No delivery slot"
      }
    >
      <span
        className={cn(
          "flex items-center justify-center bg-muted-foreground text-background",
          sz.square
        )}
      >
        <Archive size={sz.icon} aria-hidden />
      </span>
      <span
        className={cn(
          "flex items-center justify-center border-l border-muted-foreground text-muted-foreground",
          sz.square
        )}
      >
        {slotLabel(slot, reporting)}
      </span>
    </span>
  );
}

/**
 * Editable variant: clicking the right square opens a native dropdown via an
 * invisible `<select>` overlay (same trick as `SelectSegment` in the
 * conditions editor). `onFocus` / `onBlur` are forwarded to that select so
 * the panel's `useInstantField` can flush autosave and clear presence focus
 * on blur — the panel relies on this contract.
 */
export function SlotPillSelect({
  slot,
  reporting,
  onChange,
  onFocus,
  onBlur,
  size = "sm",
  className,
}: {
  slot: number | null;
  reporting: boolean;
  onChange: (next: { slot: number | null; reporting: boolean }) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  size?: SlotPillSize;
  className?: string;
}) {
  const sz = SIZE_CLASSES[size];
  const value = reporting ? SLOT_REPORTING : slot != null ? String(slot) : "";
  return (
    <span
      className={cn(
        "relative inline-flex cursor-pointer items-stretch overflow-hidden rounded border border-muted-foreground font-mono",
        sz.text,
        className
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center bg-muted-foreground text-background",
          sz.square
        )}
      >
        <Archive size={sz.icon} aria-hidden />
      </span>
      <span
        className={cn(
          "flex items-center justify-center border-l border-muted-foreground text-muted-foreground",
          sz.square
        )}
      >
        <span aria-hidden>{slotLabel(slot, reporting)}</span>
      </span>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === SLOT_REPORTING)
            onChange({ slot: null, reporting: true });
          else if (v === "") onChange({ slot: null, reporting: false });
          else onChange({ slot: Number(v), reporting: false });
        }}
        onFocus={onFocus}
        onBlur={onBlur}
        aria-label="Delivery slot"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">—</option>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <option key={n} value={String(n)}>
            {n}
          </option>
        ))}
        <option value={SLOT_REPORTING}>Reporting</option>
      </select>
    </span>
  );
}
