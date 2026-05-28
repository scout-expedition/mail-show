"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { usePresenceContext } from "@/lib/realtime/presence-context";

/** Tables we care about — only refreshes triggered by these tables are
 *  forwarded to the route's server component. Anything else on the channel
 *  (e.g. cross-surface noise that may land here via a future shared
 *  channel) is ignored. */
const SYNC_TABLES = new Set([
  "playthroughs",
  "playthrough_action_choices",
  "playthrough_phase_log",
  "playthrough_phase_timer_adjustments",
  "playthrough_report_segments_fired",
]);

const DEBOUNCE_MS = 250;

/**
 * Subscribes the play-mode surface to postgres_changes on the playthrough's
 * realtime channel and refreshes the route on each relevant change. The
 * server component (`/playthroughs/[id]/page.tsx`) re-runs its queries,
 * which propagates updated playthrough rows, choices, phase log, and the
 * delivered-letters view into the shell.
 *
 * Debounced to ≥250ms so a single `advancePhase` RPC — which writes to the
 * playthrough row, the phase log, and (sometimes) several action-choice
 * rows in one transaction — produces one refresh, not several.
 *
 * The `playthroughId` arg gates events to the relevant playthrough so
 * cross-playthrough writes (extremely unlikely on a channel scoped to
 * `playthrough:<id>` but defensible regardless) don't cause refresh
 * churn.
 */
export function usePlaythroughSync(playthroughId: string): void {
  const { onPostgresChanges } = usePresenceContext();
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function scheduleRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        router.refresh();
      }, DEBOUNCE_MS);
    }

    const unsub = onPostgresChanges((change) => {
      if (!SYNC_TABLES.has(change.table)) return;
      // Both `new` and `old` may be present depending on event type; filter
      // by playthrough_id on either side so we ignore writes that don't
      // touch this playthrough.
      const newRow = (change as { new?: Record<string, unknown> }).new;
      const oldRow = (change as { old?: Record<string, unknown> }).old;
      const matchedId =
        (newRow?.playthrough_id as string | undefined) ??
        (newRow?.id as string | undefined) ??
        (oldRow?.playthrough_id as string | undefined) ??
        (oldRow?.id as string | undefined);
      if (matchedId && matchedId !== playthroughId) return;
      scheduleRefresh();
    });

    return () => {
      unsub();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [onPostgresChanges, router, playthroughId]);
}
