"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/panel";
import type { Day } from "@/lib/db/types";
import { createNextDay } from "@/app/(authed)/inspection/letters/actions";

/**
 * Day dropdown with a "+ Day" entry. `groupDefaultId` (optional) labels the
 * group-default day with "(Group Default)" inside the open dropdown list
 * only — the collapsed display shows the plain day name. Implemented as a
 * custom popover so the displayed label can differ from the list label.
 */
export function DaySelect({
  value,
  days,
  groupDefaultId,
  hideClear,
  dashWhenGroupDefault,
  defaultSuffix,
  onChange,
  className,
}: {
  value: string;
  days: Day[];
  groupDefaultId?: string | null;
  /** When true, the "—" clear option is not rendered in the dropdown. */
  hideClear?: boolean;
  /** When true, the closed button shows "—" whenever value equals groupDefaultId. */
  dashWhenGroupDefault?: boolean;
  /** Appended in parens when value equals groupDefaultId, e.g. "(Following Day)". */
  defaultSuffix?: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const [creating, startCreate] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = value ? days.find((d) => d.id === value) ?? null : null;
  const isGroupDefault =
    !!selected && !!groupDefaultId && selected.id === groupDefaultId;
  const displayText =
    selected && isGroupDefault && dashWhenGroupDefault
      ? "—"
      : selected
        ? `${selected.identifier}${selected.name ? ` — ${selected.name}` : ""}${
            isGroupDefault && defaultSuffix ? ` ${defaultSuffix}` : ""
          }`
        : "—";

  if (creating) {
    return (
      <span
        role="status"
        aria-label="Creating day"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border bg-muted px-3 font-mono text-sm text-muted-foreground",
          className
        )}
      >
        <Spinner />
        Creating…
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border border-border bg-input px-3 text-left font-mono text-sm",
          className
        )}
      >
        <span className="truncate">{displayText}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="shrink-0 text-muted-foreground"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card shadow-md"
        >
          {!hideClear ? (
            <DayOption
              active={value === ""}
              onPick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              —
            </DayOption>
          ) : null}
          {days.map((d) => (
            <DayOption
              key={d.id}
              active={value === d.id}
              onPick={() => {
                onChange(d.id);
                setOpen(false);
              }}
            >
              {d.identifier}
              {d.name ? ` — ${d.name}` : ""}
              {groupDefaultId && d.id === groupDefaultId ? (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {defaultSuffix ?? "(Group Default)"}
                </span>
              ) : null}
            </DayOption>
          ))}
          <DayOption
            active={false}
            onPick={() => {
              setOpen(false);
              startCreate(async () => {
                const { newDayId } = await createNextDay();
                onChange(newDayId);
              });
            }}
          >
            <span className="text-muted-foreground">+ Day</span>
          </DayOption>
        </div>
      ) : null}
    </div>
  );
}

function DayOption({
  active,
  onPick,
  children,
}: {
  active: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-1 px-3 py-1.5 text-left font-mono text-sm hover:bg-accent/40",
        active && "bg-accent/30"
      )}
    >
      {children}
    </button>
  );
}
