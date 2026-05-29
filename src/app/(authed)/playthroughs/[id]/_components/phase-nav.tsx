"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PHASES, PHASE_LABELS, type Phase } from "@/lib/db/enums";
import { cn } from "@/lib/utils";
import type { Day, Playthrough, PlaythroughPhaseLog } from "@/lib/db/types";
import { goToPhase } from "../_actions/play-actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase);
}

/** Compare (dayNumber, phase) tuples. Returns -1 / 0 / 1. */
function compareDayPhase(
  aDayNum: number,
  aPhase: Phase,
  bDayNum: number,
  bPhase: Phase
): number {
  if (aDayNum !== bDayNum) return aDayNum < bDayNum ? -1 : 1;
  const ai = phaseIndex(aPhase);
  const bi = phaseIndex(bPhase);
  if (ai !== bi) return ai < bi ? -1 : 1;
  return 0;
}

function prevDayPhase(
  currentDay: Day,
  currentPhase: Phase,
  days: Day[]
): { dayId: string; phase: Phase } | null {
  const pi = phaseIndex(currentPhase);
  if (pi > 0) {
    return { dayId: currentDay.id, phase: PHASES[pi - 1] };
  }
  const prevDay = days.find((d) => d.number === currentDay.number - 1);
  if (!prevDay) return null;
  return { dayId: prevDay.id, phase: "end_of_day" };
}

function nextDayPhase(
  currentDay: Day,
  currentPhase: Phase,
  days: Day[]
): { dayId: string; phase: Phase } | null {
  const pi = phaseIndex(currentPhase);
  if (pi < PHASES.length - 1) {
    return { dayId: currentDay.id, phase: PHASES[pi + 1] };
  }
  const nd = days.find((d) => d.number === currentDay.number + 1);
  if (!nd) return null;
  return { dayId: nd.id, phase: "top_of_day" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PhaseNav({
  playthrough,
  currentDay,
  days,
  phaseLogs,
}: {
  playthrough: Playthrough;
  currentDay: Day;
  days: Day[];
  phaseLogs: PlaythroughPhaseLog[];
}) {
  const [pending, startTransition] = useTransition();

  const furthestDay = days.find((d) => d.id === playthrough.furthest_day_id);
  const atFurthest =
    !furthestDay ||
    !playthrough.furthest_phase ||
    compareDayPhase(
      currentDay.number,
      playthrough.current_phase,
      furthestDay.number,
      playthrough.furthest_phase
    ) >= 0;

  // --- Back ---
  const prev = prevDayPhase(currentDay, playthrough.current_phase, days);
  const canGoBack = !!prev && hasVisited(prev.dayId, prev.phase, phaseLogs);

  // --- Forward (only when current < furthest) ---
  const next = !atFurthest
    ? nextDayPhase(currentDay, playthrough.current_phase, days)
    : null;
  const canGoForward = !!next && !atFurthest;

  function navigate(dayId: string, phase: Phase) {
    startTransition(async () => {
      await goToPhase(playthrough.id, dayId, phase);
    });
  }

  return (
    <div className="flex items-center gap-1">
      <NavButton
        direction="back"
        disabled={!canGoBack || pending}
        onClick={() => prev && navigate(prev.dayId, prev.phase)}
        playthrough={playthrough}
        currentDay={currentDay}
        days={days}
        phaseLogs={phaseLogs}
        onJump={navigate}
      />
      <NavButton
        direction="forward"
        disabled={!canGoForward || pending}
        onClick={() => next && navigate(next.dayId, next.phase)}
        playthrough={playthrough}
        currentDay={currentDay}
        days={days}
        phaseLogs={phaseLogs}
        onJump={navigate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// NavButton with long-press popover
// ---------------------------------------------------------------------------

function NavButton({
  direction,
  disabled,
  onClick,
  playthrough,
  currentDay,
  days,
  phaseLogs,
  onJump,
}: {
  direction: "back" | "forward";
  disabled: boolean;
  onClick: () => void;
  playthrough: Playthrough;
  currentDay: Day;
  days: Day[];
  phaseLogs: PlaythroughPhaseLog[];
  onJump: (dayId: string, phase: Phase) => void;
}) {
  const [showPopover, setShowPopover] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  function onPointerDown() {
    if (disabled) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      setShowPopover(true);
    }, 600);
  }

  function onPointerUp() {
    if (timerRef.current) {
      clearTimer();
      if (!showPopover) onClick();
    }
  }

  useEffect(() => {
    if (!showPopover) return;
    function onOutside(e: PointerEvent) {
      const t = e.target as Node | null;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setShowPopover(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPopover(false);
    }
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [showPopover]);

  // Build the list of visited phases for the popover. Group by day.
  const dayById = new Map(days.map((d) => [d.id, d]));
  const visitedEntries = phaseLogs
    .map((log) => ({
      dayId: log.day_id,
      phase: log.phase,
      dayNumber: dayById.get(log.day_id)?.number ?? 0,
      dayIdentifier: dayById.get(log.day_id)?.identifier ?? "?",
    }))
    .sort((a, b) => compareDayPhase(a.dayNumber, a.phase, b.dayNumber, b.phase));

  // Deduplicate (same day+phase, keep first)
  const seen = new Set<string>();
  const uniqueEntries = visitedEntries.filter((e) => {
    const key = `${e.dayId}:${e.phase}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const Icon = direction === "back" ? ChevronLeft : ChevronRight;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={clearTimer}
        aria-label={direction === "back" ? "Go back" : "Go forward"}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors",
          disabled
            ? "cursor-not-allowed opacity-30"
            : "hover:bg-accent hover:text-foreground"
        )}
      >
        <Icon size={14} aria-hidden />
      </button>
      {showPopover && uniqueEntries.length > 0 ? (
        <div
          ref={popRef}
          role="menu"
          className={cn(
            "absolute top-full z-40 mt-1 w-52 rounded-md border border-border bg-popover py-1 shadow-xl",
            direction === "back" ? "left-0" : "right-0"
          )}
        >
          <p className="px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            History
          </p>
          <div className="max-h-64 overflow-y-auto">
            {uniqueEntries.map((e) => {
              const isCurrent =
                e.dayId === playthrough.current_day_id &&
                e.phase === playthrough.current_phase;
              return (
                <button
                  key={`${e.dayId}:${e.phase}`}
                  type="button"
                  role="menuitem"
                  disabled={isCurrent}
                  onClick={() => {
                    onJump(e.dayId, e.phase);
                    setShowPopover(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                    isCurrent
                      ? "bg-accent/50 text-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <span className="font-mono text-[10px]">{e.dayIdentifier}</span>
                  <span>{PHASE_LABELS[e.phase]}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasVisited(
  dayId: string,
  phase: Phase,
  phaseLogs: PlaythroughPhaseLog[]
): boolean {
  return phaseLogs.some((log) => log.day_id === dayId && log.phase === phase);
}
