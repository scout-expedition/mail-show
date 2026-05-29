"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { VariableHud } from "@/components/variable-hud";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import { usePresenceContext } from "@/lib/realtime/presence-context";
import { PHASE_LABELS } from "@/lib/db/enums";
import type { Day, Playthrough, PlaythroughVariables } from "@/lib/db/types";
import { GameTimer } from "./game-timer";
import { PlayMenu } from "./play-menu";

/** Top bar that replaces the planner's left nav inside play mode. Hosts
 *  exit-to-list, name + active badge, current day + phase, the variable
 *  HUD, the realtime AvatarStack, and the admin menu. The GameTimer
 *  slot lands in Track A. */
export function PlayNavbar({
  playthrough,
  currentDay,
  vars,
  phaseNav,
}: {
  playthrough: Playthrough;
  currentDay: Day | null;
  vars: PlaythroughVariables | null;
  phaseNav?: React.ReactNode;
}) {
  const { peers, selfPeer } = usePresenceContext();
  const hudVars = vars
    ? (() => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { playthrough_id: _, ...rest } = vars;
        return rest;
      })()
    : undefined;

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background/80 px-4 backdrop-blur">
      <Link
        href="/playthroughs"
        aria-label="Exit play mode"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ArrowLeft size={16} aria-hidden />
      </Link>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{playthrough.name}</span>
        {playthrough.is_active ? <Badge variant="success">active</Badge> : null}
      </div>
      <div className="flex items-center gap-2 text-sm">
        {currentDay ? (
          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
            {currentDay.identifier}
          </span>
        ) : null}
        <span className="text-muted-foreground">
          {PHASE_LABELS[playthrough.current_phase]}
        </span>
      </div>
      {phaseNav}
      <GameTimer playthrough={playthrough} />
      <div className="ml-auto flex items-center gap-3">
        <VariableHud
          vars={hudVars}
          playthroughName={playthrough.name}
        />
        {peers.length > 0 || selfPeer ? (
          <AvatarStack peers={peers} self={selfPeer} popupAlign="right" />
        ) : null}
        <PlayMenu playthrough={playthrough} />
      </div>
    </header>
  );
}
