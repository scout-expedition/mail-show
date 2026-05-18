"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { cn } from "@/lib/utils";
import type { Day } from "@/lib/db/types";
import { createNextDay } from "./actions";

export type DeliveryOverride =
  | { kind: "none" }
  | { kind: "offset"; offset: number }
  | { kind: "absolute"; dayId: string };

type Props = {
  /**
   * The day that the picker's relative offsets are measured from.
   * `offsetFromBase` lets reports treat "base + 1" as their default
   * (i.e. base = triggering letter's effective day, offsetFromBase = 1).
   */
  base: { dayId: string | null; offsetFromBase?: number };
  override: DeliveryOverride;
  days: Day[];
  /** Letters: true. Reports: false. */
  allowNegative: boolean;
  /** Minimum signed offset for `+X` input. Reports pass 1. */
  minOffset?: number;
  onChange: (next: DeliveryOverride) => void;
  className?: string;
};

const BAKED_OFFSETS = [1, 2] as const;

function formatOffsetLabel(offset: number) {
  const sign = offset > 0 ? "+" : "−";
  const magnitude = Math.abs(offset);
  const noun = magnitude === 1 ? "Day" : "Days";
  return `${sign}${magnitude} ${noun}`;
}

function findDayByNumber(days: Day[], number: number): Day | undefined {
  return days.find((d) => d.number === number);
}

export function DeliveryDayPicker({
  base,
  override,
  days,
  allowNegative,
  minOffset,
  onChange,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [creating, startCreate] = useTransition();
  const formatDraft = useCallback(
    (n: number) => (n >= 0 ? `+${n}` : `${n}`),
    []
  );
  const [customDraft, setCustomDraft] = useState(() =>
    override.kind === "offset" ? formatDraft(override.offset) : ""
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const customInputId = useId();

  const openMenu = useCallback(() => {
    setCustomDraft(
      override.kind === "offset" ? formatDraft(override.offset) : ""
    );
    setOpen(true);
  }, [override, formatDraft]);

  const baseDay = useMemo(
    () => (base.dayId ? days.find((d) => d.id === base.dayId) ?? null : null),
    [base.dayId, days]
  );
  const baseOffset = base.offsetFromBase ?? 0;
  const defaultDayNumber =
    baseDay != null ? baseDay.number + baseOffset : null;
  const defaultDay =
    defaultDayNumber != null
      ? findDayByNumber(days, defaultDayNumber) ?? null
      : null;

  const effectiveDayNumber = useMemo(() => {
    if (defaultDayNumber == null) return null;
    if (override.kind === "offset") return defaultDayNumber + override.offset;
    if (override.kind === "absolute") {
      const d = days.find((x) => x.id === override.dayId);
      return d ? d.number : null;
    }
    return defaultDayNumber;
  }, [override, defaultDayNumber, days]);

  const effectiveDay =
    effectiveDayNumber != null ? findDayByNumber(days, effectiveDayNumber) : undefined;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);


  const bakedOffsets = useMemo(
    () =>
      BAKED_OFFSETS.filter((n) => (minOffset == null ? true : n >= minOffset)),
    [minOffset]
  );

  const isBaked = useCallback(
    (n: number) => bakedOffsets.includes(n as (typeof bakedOffsets)[number]),
    [bakedOffsets]
  );

  const commitOffset = useCallback(
    (parsed: number) => {
      if (!Number.isInteger(parsed)) return;
      if (!allowNegative && parsed < (minOffset ?? 1)) return;
      if (allowNegative && parsed === 0) {
        onChange({ kind: "none" });
        setOpen(false);
        return;
      }
      if (defaultDayNumber != null) {
        const target = defaultDayNumber + parsed;
        if (!findDayByNumber(days, target)) return;
      }
      onChange({ kind: "offset", offset: parsed });
      setOpen(false);
    },
    [allowNegative, minOffset, onChange, defaultDayNumber, days]
  );

  const commitCustomDraft = useCallback(() => {
    const trimmed = customDraft.trim();
    if (trimmed === "" || trimmed === "-") return;
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) return;
    commitOffset(parsed);
  }, [customDraft, commitOffset]);

  const nextDayNumber = useMemo(
    () => (days.length === 0 ? 1 : Math.max(...days.map((d) => d.number)) + 1),
    [days]
  );

  const customParsed = useMemo(() => {
    const trimmed = customDraft.trim();
    if (trimmed === "" || trimmed === "-" || trimmed === "+") return null;
    const n = Number(trimmed);
    return Number.isInteger(n) ? n : null;
  }, [customDraft]);
  // Valid offsets the bump buttons can land on: every existing day minus the
  // default day number, filtered to non-zero (zero = no override = handled
  // separately) and clamped to the minOffset floor for reports.
  const validOffsets = useMemo(() => {
    if (defaultDayNumber == null) return [] as number[];
    const floor = !allowNegative ? minOffset ?? 1 : Number.NEGATIVE_INFINITY;
    return days
      .map((d) => d.number - defaultDayNumber)
      .filter((o) => o !== 0 && o >= floor)
      .sort((a, b) => a - b);
  }, [days, defaultDayNumber, allowNegative, minOffset]);

  const bumpCustomDraft = useCallback(
    (delta: number) => {
      if (validOffsets.length === 0) return;
      const current = customParsed ?? 0;
      let next: number | undefined;
      if (delta > 0) {
        next = validOffsets.find((o) => o > current);
        if (next === undefined) next = validOffsets[validOffsets.length - 1];
      } else {
        for (let i = validOffsets.length - 1; i >= 0; i--) {
          if (validOffsets[i] < current) {
            next = validOffsets[i];
            break;
          }
        }
        if (next === undefined) next = validOffsets[0];
      }
      setCustomDraft(next >= 0 ? `+${next}` : `${next}`);
    },
    [validOffsets, customParsed]
  );
  const customPreviewDayNumber =
    customParsed != null && defaultDayNumber != null
      ? defaultDayNumber + customParsed
      : null;
  const customPreviewDay =
    customPreviewDayNumber != null
      ? findDayByNumber(days, customPreviewDayNumber)
      : undefined;

  const closedInvalid =
    override.kind === "offset" &&
    (effectiveDayNumber == null || !effectiveDay);

  const customSelected =
    override.kind === "offset" && !isBaked(override.offset);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border bg-input px-3 text-left font-mono text-sm"
        )}
      >
        <span
          className={cn(
            "truncate",
            closedInvalid && "text-destructive",
            override.kind === "none" && "text-muted-foreground/60"
          )}
        >
          {override.kind === "none" ? (
            "—"
          ) : override.kind === "offset" ? (
            <>
              {formatOffsetLabel(override.offset)}
              <span className="ml-1 text-[10px] text-muted-foreground">
                {effectiveDay
                  ? `(${effectiveDay.identifier})`
                  : effectiveDayNumber != null
                    ? `(D${effectiveDayNumber} no day)`
                    : ""}
              </span>
            </>
          ) : (
            days.find((d) => d.id === override.dayId)?.identifier ?? "—"
          )}
        </span>
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
          className="absolute left-0 top-full z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border border-border bg-card shadow-md"
        >
          <PickerRow
            active={override.kind === "none"}
            onPick={() => {
              onChange({ kind: "none" });
              setOpen(false);
            }}
          >
            <span className="text-muted-foreground">—</span>
          </PickerRow>

          <div className="my-1 border-t border-border" />
          <div className="px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Relative
          </div>
          {bakedOffsets.map((offset) => {
            const dayNumber =
              defaultDayNumber != null ? defaultDayNumber + offset : null;
            const day =
              dayNumber != null ? findDayByNumber(days, dayNumber) : undefined;
            const active =
              override.kind === "offset" && override.offset === offset;
            const disabled = !day;
            return (
              <PickerRow
                key={offset}
                active={active}
                disabled={disabled}
                onPick={() => commitOffset(offset)}
              >
                <span>{offset > 0 ? `+${offset}` : `−${Math.abs(offset)}`}</span>
                <span className="ml-1 text-[10px] text-muted-foreground">
                  {day
                    ? `(${day.identifier})`
                    : dayNumber != null
                      ? `(D${dayNumber} no day)`
                      : ""}
                </span>
              </PickerRow>
            );
          })}

          <div
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 font-mono text-sm hover:bg-accent/40",
              customSelected && "bg-accent/30"
            )}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button, input")) return;
              commitCustomDraft();
            }}
          >
            <input
              id={customInputId}
              type="text"
              inputMode="numeric"
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCustomDraft();
                }
              }}
              placeholder={allowNegative ? "±X" : "+X"}
              className={cn(
                "h-5 w-9 rounded border bg-input px-1 text-left font-mono text-sm placeholder:text-muted-foreground/60",
                customParsed != null && !customPreviewDay
                  ? "border-destructive"
                  : "border-border"
              )}
              aria-label="Custom offset"
              title={
                customParsed != null && !customPreviewDay
                  ? "That day doesn't exist — pick another offset"
                  : undefined
              }
            />
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                aria-label="Increment"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  bumpCustomDraft(1);
                }}
                className="flex h-[9px] w-4 items-center justify-center rounded border border-border bg-input text-[8px] leading-none hover:bg-accent/40"
              >
                +
              </button>
              <button
                type="button"
                aria-label="Decrement"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  bumpCustomDraft(-1);
                }}
                className="flex h-[9px] w-4 items-center justify-center rounded border border-border bg-input text-[8px] leading-none hover:bg-accent/40"
              >
                −
              </button>
            </div>
            <span className="ml-1 text-[10px] text-muted-foreground">
              {customPreviewDay
                ? `(${customPreviewDay.identifier})`
                : customPreviewDayNumber != null
                  ? `(D${customPreviewDayNumber} no day)`
                  : ""}
            </span>
          </div>

          <div className="my-1 border-t border-border" />
          <div className="px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Absolute
          </div>
          {days
            .filter((d) => !defaultDay || d.id !== defaultDay.id)
            .map((d) => {
              const active =
                override.kind === "absolute" && override.dayId === d.id;
              return (
                <PickerRow
                  key={d.id}
                  active={active}
                  onPick={() => {
                    onChange({ kind: "absolute", dayId: d.id });
                    setOpen(false);
                  }}
                >
                  <span>{d.identifier}</span>
                  {d.name ? (
                    <span className="text-muted-foreground"> — {d.name}</span>
                  ) : null}
                </PickerRow>
              );
            })}

          <PickerRow
            active={false}
            disabled={creating}
            onPick={() => {
              setOpen(false);
              startCreate(async () => {
                const { newDayId } = await createNextDay();
                onChange({ kind: "absolute", dayId: newDayId });
              });
            }}
          >
            <span className="text-muted-foreground">
              {creating ? "Creating…" : `+ Add D${nextDayNumber}`}
            </span>
          </PickerRow>
        </div>
      ) : null}
    </div>
  );
}

function PickerRow({
  active,
  disabled,
  onPick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        onPick();
      }}
      className={cn(
        "flex w-full items-center gap-1 px-3 py-1.5 text-left font-mono text-sm",
        active && "bg-accent/30",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-accent/40"
      )}
    >
      {children}
    </button>
  );
}

