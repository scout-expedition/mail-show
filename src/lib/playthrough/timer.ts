import type { Day, Playthrough } from "@/lib/db/types";

/**
 * Pure timer helpers for the play-through game clock and per-phase countdown.
 *
 * All functions accept a `nowMs` argument (milliseconds since Unix epoch)
 * supplied by `useServerClock` — no internal `Date.now()` calls so the
 * display stays authoritative to the server's sense of time.
 *
 * Terminology:
 *   "game clock"  — total wall time since `started_at`, minus all paused slices.
 *   "phase clock" — time spent in the current phase, minus phase paused slices.
 */

/** True when the playthrough is currently paused (game clock frozen). */
function isGamePaused(p: Playthrough): boolean {
  return p.paused_at !== null;
}

/**
 * Total game elapsed in milliseconds.
 *
 * If the game hasn't started yet, returns 0.
 * If the game is paused, the clock reads the frozen value at pause time.
 * If running, the clock ticks from `started_at` minus all accumulated pause
 * durations (`total_paused_ms`) and the current live pause slice (if any).
 */
export function gameElapsedMs(p: Playthrough, nowMs: number): number {
  if (!p.started || p.started_at === null) return 0;

  const startedAtMs = new Date(p.started_at).getTime();

  if (isGamePaused(p)) {
    // Clock is frozen: elapsed = (paused_at - started_at) - total_paused_ms
    const pausedAtMs = new Date(p.paused_at!).getTime();
    return Math.max(0, pausedAtMs - startedAtMs - p.total_paused_ms);
  }

  // Running: elapsed = (now - started_at) - total_paused_ms
  return Math.max(0, nowMs - startedAtMs - p.total_paused_ms);
}

/**
 * Phase elapsed in milliseconds — time spent in the current phase.
 *
 * If `phase_started_at` is not set, returns 0.
 * If the game/phase is paused, the clock reads the frozen value at phase
 * pause time (which is always the same moment as `paused_at` since
 * `pauseGame` / `resumeGame` toggle both together).
 */
export function phaseElapsedMs(p: Playthrough, nowMs: number): number {
  if (p.phase_started_at === null) return 0;

  const phaseStartMs = new Date(p.phase_started_at).getTime();

  if (isGamePaused(p)) {
    // Both game and phase pause at the same instant.
    const phasePausedAtMs =
      p.phase_paused_at !== null
        ? new Date(p.phase_paused_at).getTime()
        : phaseStartMs; // defensive — should always be set with paused_at
    return Math.max(
      0,
      phasePausedAtMs - phaseStartMs - p.phase_total_paused_ms
    );
  }

  return Math.max(0, nowMs - phaseStartMs - p.phase_total_paused_ms);
}

/**
 * Remaining milliseconds in the current phase (for timed phases only).
 *
 * - Returns `null` for untimed phases (`top_of_day`, `end_of_day`).
 * - Uses `phase_allotted_override_ms` if set on the playthrough row
 *   (overrides the day's default for the current phase).
 * - Falls back to `day.sort_phase_length_seconds` or
 *   `day.inspection_phase_length_seconds` (in seconds → ms).
 * - Returns `null` if no allotment is configured at all.
 *
 * A negative return value means the phase is in overtime; callers can
 * `Math.abs()` to display the overtime duration.
 */
export function phaseRemainingMs(
  p: Playthrough,
  day: Day,
  nowMs: number
): number | null {
  // Top-of-day and end-of-day are untimed.
  if (p.current_phase === "top_of_day" || p.current_phase === "end_of_day") {
    return null;
  }

  // Determine allotted duration: per-playthrough override wins.
  let allottedMs: number | null = null;
  if (p.phase_allotted_override_ms !== null) {
    allottedMs = p.phase_allotted_override_ms;
  } else if (p.current_phase === "sorting") {
    allottedMs =
      day.sort_phase_length_seconds !== null
        ? day.sort_phase_length_seconds * 1000
        : null;
  } else if (p.current_phase === "inspection") {
    allottedMs =
      day.inspection_phase_length_seconds !== null
        ? day.inspection_phase_length_seconds * 1000
        : null;
  }

  if (allottedMs === null) return null;

  const elapsed = phaseElapsedMs(p, nowMs);
  return allottedMs - elapsed;
}
