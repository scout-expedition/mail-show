"use client";

import { usePathname } from "next/navigation";
import { isHideChromePath } from "@/components/nav";
import { VariableHud } from "@/components/variable-hud";
import { PHASE_LABELS } from "@/lib/db/enums";
import type { Day, Playthrough, PlaythroughVariables } from "@/lib/db/types";

/** AppShell's sticky top HUD. Renders day badge + phase label + variable
 *  tally for the active playthrough. Suppressed on routes that take over
 *  the viewport with their own chrome (currently `/playthroughs/[id]`,
 *  which renders `<PlayNavbar>` instead). */
export function AppShellHud({
  activePlaythrough,
  currentDay,
  vars,
}: {
  activePlaythrough: Playthrough | null;
  currentDay: Day | null;
  vars: Omit<PlaythroughVariables, "playthrough_id"> | undefined;
}) {
  const pathname = usePathname();
  if (!activePlaythrough) return null;
  if (isHideChromePath(pathname)) return null;
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-5 backdrop-blur">
      <div className="flex items-center gap-3 text-sm">
        {currentDay ? (
          <>
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
              {currentDay.identifier}
            </span>
            <span className="text-muted-foreground">
              {PHASE_LABELS[activePlaythrough.current_phase]}
            </span>
          </>
        ) : null}
      </div>
      <VariableHud
        vars={vars}
        playthroughName={activePlaythrough.name}
      />
    </header>
  );
}
