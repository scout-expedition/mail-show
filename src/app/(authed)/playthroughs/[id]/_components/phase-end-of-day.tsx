"use client";

// C4 — End-of-Day phase content.
//
// Untimed transition: renders a short summary of the day's outcomes and a
// "Next" button that advances to the next day's top-of-day phase.
//
// The "Next" button dispatches a stub action for now — Track C5 will wire the
// advancePhase RPC once it lands.

import { useTransition } from "react";
import { ArrowRight, Flag } from "lucide-react";
import type { Day, PlaythroughVariables } from "@/lib/db/types";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";
import { advancePhase, endPlaythrough } from "../_actions/play-actions";

// ── Phase wrapper ─────────────────────────────────────────────────────────────

/**
 * C4 — End-of-Day phase. Client component (needs button transition state).
 *
 * @param vars  Current cumulative variable tallies for the playthrough.
 *              Null when the view hasn't been calculated yet (e.g. no choices).
 */
export function PhaseEndOfDay({
  playthroughId,
  day,
  vars,
  hideAdvance = false,
  isFinalDay = false,
}: {
  playthroughId: string;
  day: Day;
  vars: PlaythroughVariables | null;
  hideAdvance?: boolean;
  isFinalDay?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleNext() {
    startTransition(async () => {
      await advancePhase(playthroughId, "end_of_day");
    });
  }

  function handleEnd() {
    startTransition(async () => {
      await endPlaythrough(playthroughId);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Phase header */}
      <div className="flex flex-col gap-1">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          End of Day — {day.identifier}
          {day.name ? ` — ${day.name}` : ""}
        </div>
        <p className="text-xs text-muted-foreground/70">
          The day is complete. Review the day&apos;s outcomes below, then
          advance to the next day.
        </p>
      </div>

      {/* Sign-off text (if set on the day) */}
      {day.end_of_day_sign_off ? (
        <div className="rounded-md border border-border bg-card p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Sign-off
          </p>
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">
            {day.end_of_day_sign_off}
          </p>
        </div>
      ) : null}

      {/* Cumulative variable summary */}
      {vars ? (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Cumulative Impact
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {(
              [
                "world_status",
                "demerits",
                "proletariat",
                "gentry",
                "epicenter",
                "folos",
                "emberlyn",
                "spokgrad",
                "pelico",
                "combined_national",
              ] as const
            ).map((key) => {
              const value = vars[key];
              const label = VARIABLE_LABELS[key];
              const positive = value > 0;
              const negative = value < 0;
              return (
                <div
                  key={key}
                  className="flex flex-col gap-0.5 rounded-md border border-border bg-card px-3 py-2"
                >
                  <span className="font-mono text-[10px] text-muted-foreground truncate">
                    {label}
                  </span>
                  <span
                    className={
                      positive
                        ? "font-mono text-sm font-semibold text-green-400"
                        : negative
                          ? "font-mono text-sm font-semibold text-red-400"
                          : "font-mono text-sm font-semibold text-muted-foreground"
                    }
                  >
                    {positive ? "+" : ""}
                    {value}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-xs italic text-muted-foreground/60">
          No impact data — no actions chosen this run.
        </p>
      )}

      {/* Next / End button (hidden when viewing a past phase via back-nav) */}
      {!hideAdvance ? (
        <div className="flex justify-end gap-2">
          {isFinalDay ? (
            <button
              type="button"
              onClick={handleEnd}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground shadow transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              {isPending ? (
                "Ending…"
              ) : (
                <>
                  End playthrough
                  <Flag size={16} aria-hidden />
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? (
                "Advancing…"
              ) : (
                <>
                  Next day
                  <ArrowRight size={16} aria-hidden />
                </>
              )}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
