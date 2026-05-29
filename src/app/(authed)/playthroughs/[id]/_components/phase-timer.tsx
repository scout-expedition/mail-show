"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useServerClock } from "@/lib/playthrough/use-server-clock";
import { phaseElapsedMs, phaseRemainingMs } from "@/lib/playthrough/timer";
import {
  pauseGame,
  resumeGame,
  adjustPhaseAllotment,
  restartPhaseTimer,
} from "../_actions/play-actions";
import type { Day, Playthrough } from "@/lib/db/types";

const TICK_MS = 500;

const DELTA_BUTTONS: { label: string; deltaMs: number }[] = [
  { label: "+5s", deltaMs: 5_000 },
  { label: "+15s", deltaMs: 15_000 },
  { label: "+30s", deltaMs: 30_000 },
  { label: "−5s", deltaMs: -5_000 },
  { label: "−15s", deltaMs: -15_000 },
  { label: "−30s", deltaMs: -30_000 },
];

/** Format a signed millisecond value as `[−]MM:SS` countdown display.
 *  Negative values (overtime) are shown as a positive overtime reading. */
function formatCountdown(ms: number): {
  display: string;
  overtime: boolean;
} {
  const overtime = ms < 0;
  const abs = Math.abs(ms);
  const totalSeconds = Math.floor(abs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return {
    display: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
    overtime,
  };
}

/**
 * Phase countdown timer shown during `sorting` and `inspection` phases.
 *
 * Features:
 * - Countdown from allotted time; flips to a positive overtime reading past 0.
 * - Pause/resume button (mirrors the game timer — both clocks share the same
 *   `pauseGame`/`resumeGame` server actions since they toggle together).
 * - ±5/15/30s adjustment buttons that call `adjustPhaseAllotment`.
 * - Restart button that resets the phase clock and rewinds the game clock by
 *   the elapsed phase duration.
 *
 * Only renders for `sorting` and `inspection` — callers should gate rendering
 * on `playthrough.current_phase`.
 */
export function PhaseTimer({
  playthrough,
  currentDay,
  disabled = false,
}: {
  playthrough: Playthrough;
  currentDay: Day;
  disabled?: boolean;
}) {
  const nowMs = useServerClock();

  const computeRemaining = () => phaseRemainingMs(playthrough, currentDay, nowMs());
  const [remaining, setRemaining] = useState<number | null>(computeRemaining);
  const [pending, startTransition] = useTransition();

  // Keep a ref to the latest props so the interval closure stays fresh.
  // useLayoutEffect (not assignment-in-render) satisfies react-hooks/refs.
  const playthroughRef = useRef(playthrough);
  useLayoutEffect(() => {
    playthroughRef.current = playthrough;
  }, [playthrough]);
  const dayRef = useRef(currentDay);
  useLayoutEffect(() => {
    dayRef.current = currentDay;
  }, [currentDay]);

  useEffect(() => {
    function tick() {
      setRemaining(phaseRemainingMs(playthroughRef.current, dayRef.current, nowMs()));
    }
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [nowMs]);

  const isPaused = playthrough.paused_at !== null;

  // Compute the current allotted ms to pass to adjustPhaseAllotment.
  function currentAllottedMs(): number {
    if (playthrough.phase_allotted_override_ms !== null) {
      return playthrough.phase_allotted_override_ms;
    }
    if (playthrough.current_phase === "sorting") {
      return (currentDay.sort_phase_length_seconds ?? 0) * 1000;
    }
    if (playthrough.current_phase === "inspection") {
      return (currentDay.inspection_phase_length_seconds ?? 0) * 1000;
    }
    return 0;
  }

  function onTogglePause() {
    startTransition(async () => {
      if (isPaused) {
        await resumeGame(playthrough.id);
      } else {
        await pauseGame(playthrough.id);
      }
    });
  }

  function onAdjust(deltaMs: number) {
    startTransition(async () => {
      await adjustPhaseAllotment(playthrough.id, deltaMs, currentAllottedMs());
    });
  }

  function onRestart() {
    const elapsed = phaseElapsedMs(playthrough, nowMs());
    startTransition(async () => {
      await restartPhaseTimer(playthrough.id, elapsed);
    });
  }

  if (remaining === null) return null;

  const { display, overtime } = formatCountdown(remaining);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Overtime indicator + countdown */}
      <div className="flex items-center gap-1.5">
        {overtime ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-destructive">
            OT
          </span>
        ) : null}
        <span
          className={`font-mono text-sm tabular-nums ${overtime ? "text-destructive" : "text-foreground"}`}
          aria-label={overtime ? "Phase overtime" : "Phase time remaining"}
        >
          {display}
        </span>
      </div>

      {/* Timer controls: hidden when viewing a past phase */}
      {!disabled ? (
        <>
          {/* Pause / resume */}
          <button
            type="button"
            onClick={onTogglePause}
            disabled={pending}
            aria-label={isPaused ? "Resume phase timer" : "Pause phase timer"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            {isPaused ? (
              <Play size={13} aria-hidden />
            ) : (
              <Pause size={13} aria-hidden />
            )}
          </button>

          {/* Restart */}
          <button
            type="button"
            onClick={onRestart}
            disabled={pending}
            aria-label="Restart phase timer"
            title="Restart phase timer (rewinds game clock by elapsed phase time)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw size={13} aria-hidden />
          </button>

          {/* ± adjustment buttons */}
          <div className="flex items-center gap-1">
            {DELTA_BUTTONS.map(({ label, deltaMs }) => (
              <button
                key={label}
                type="button"
                onClick={() => onAdjust(deltaMs)}
                disabled={pending}
                aria-label={`Adjust phase timer by ${label}`}
                className="inline-flex h-6 items-center justify-center rounded-sm border border-border bg-card/80 px-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
