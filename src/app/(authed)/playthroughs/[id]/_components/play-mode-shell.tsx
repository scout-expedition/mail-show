"use client";

import { WorkspacePresenceProvider } from "@/lib/realtime/presence-context";
import type { PresenceProfile } from "@/lib/realtime/presence";
import { usePlaythroughSync } from "@/lib/playthrough/use-playthrough-sync";
import type {
  Day,
  Playthrough,
  PlaythroughVariables,
} from "@/lib/db/types";
import { PlayNavbar } from "./play-navbar";

/** Top-level client wrapper for the play-mode surface. Opens the per-
 *  playthrough realtime channel (`playthrough:<id>`) so the navbar's
 *  AvatarStack + (eventually) Track A's timer can sync across tabs. */
export function PlayModeShell({
  playthrough,
  currentDay,
  vars,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  playthrough: Playthrough;
  currentDay: Day | null;
  vars: PlaythroughVariables | null;
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName={`playthrough:${playthrough.id}`}
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={[
        "playthroughs",
        "playthrough_action_choices",
        "playthrough_phase_log",
        "playthrough_phase_timer_adjustments",
        "playthrough_report_segments_fired",
      ]}
    >
      <PlayModeBody
        playthrough={playthrough}
        currentDay={currentDay}
        vars={vars}
      />
    </WorkspacePresenceProvider>
  );
}

/** Lives INSIDE the WorkspacePresenceProvider so it can register the
 *  postgres_changes subscription. Re-runs the route's server component on
 *  every (debounced) relevant write, which propagates updated playthrough /
 *  choices / phase log / delivered-letters into the rendered shell. */
function PlayModeBody({
  playthrough,
  currentDay,
  vars,
}: {
  playthrough: Playthrough;
  currentDay: Day | null;
  vars: PlaythroughVariables | null;
}) {
  usePlaythroughSync(playthrough.id);
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PlayNavbar
        playthrough={playthrough}
        currentDay={currentDay}
        vars={vars}
      />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        {/* Phase content renders here in Track C. */}
        <div className="rounded-md border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          Phase content lands in Track C — sorting, inspection, and end-of-day
          renderers. Foundation slice (1B) only wires the shell.
        </div>
      </main>
    </div>
  );
}
