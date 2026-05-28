"use client";

import { useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { WorkspacePresenceProvider } from "@/lib/realtime/presence-context";
import type { PresenceProfile } from "@/lib/realtime/presence";
import { usePlaythroughSync } from "@/lib/playthrough/use-playthrough-sync";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  Playthrough,
  PlaythroughVariables,
  SortingRule,
  SortingRuleCondition,
  Storyline,
} from "@/lib/db/types";
import { advancePhase, startPlaythrough } from "../_actions/play-actions";
import { PlayNavbar } from "./play-navbar";
import { PhaseEndOfDay } from "./phase-end-of-day";
import { PhaseInspection, type DeliveredLetterWithFallback } from "./phase-inspection";
import { PhaseSorting } from "./phase-sorting";
import { PhaseTimer } from "./phase-timer";
import { PhaseTopOfDay } from "./phase-top-of-day";
import { ReferencePanel } from "./reference-panel";

type SortingPhaseData = {
  rules: SortingRule[];
  conditionsByRule: Record<string, SortingRuleCondition[]>;
};

type InspectionPhaseData = {
  letters: DeliveredLetterWithFallback[];
  actionsByLetter: Record<string, ActionRow[]>;
  templates: ActionTemplate[];
  storylines: Storyline[];
  chosenActionByLetter: Record<string, string>;
};

/** Top-level client wrapper for the play-mode surface. Opens the per-
 *  playthrough realtime channel (`playthrough:<id>`) so the navbar's
 *  AvatarStack + Track A timers sync across tabs. */
export function PlayModeShell({
  playthrough,
  currentDay,
  vars,
  mapImageUrl,
  sortingPhaseData,
  inspectionPhaseData,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  playthrough: Playthrough;
  currentDay: Day | null;
  vars: PlaythroughVariables | null;
  mapImageUrl: string | null;
  sortingPhaseData: SortingPhaseData;
  inspectionPhaseData: InspectionPhaseData;
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
        mapImageUrl={mapImageUrl}
        sortingPhaseData={sortingPhaseData}
        inspectionPhaseData={inspectionPhaseData}
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
  mapImageUrl,
  sortingPhaseData,
  inspectionPhaseData,
}: {
  playthrough: Playthrough;
  currentDay: Day | null;
  vars: PlaythroughVariables | null;
  mapImageUrl: string | null;
  sortingPhaseData: SortingPhaseData;
  inspectionPhaseData: InspectionPhaseData;
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
        <PhaseContent
          playthrough={playthrough}
          currentDay={currentDay}
          vars={vars}
          sortingPhaseData={sortingPhaseData}
          inspectionPhaseData={inspectionPhaseData}
        />
      </main>
      <ReferencePanel mapImageUrl={mapImageUrl} />
    </div>
  );
}

/** Phase router. Switches on `playthrough.current_phase` and feeds each
 *  component its slice of pre-resolved data. */
function PhaseContent({
  playthrough,
  currentDay,
  vars,
  sortingPhaseData,
  inspectionPhaseData,
}: {
  playthrough: Playthrough;
  currentDay: Day | null;
  vars: PlaythroughVariables | null;
  sortingPhaseData: SortingPhaseData;
  inspectionPhaseData: InspectionPhaseData;
}) {
  // Pre-game state: no current day, or `started` is false.
  if (!playthrough.started || !currentDay) {
    return <StartGate playthrough={playthrough} />;
  }

  const advanceButton = (
    <AdvancePhaseButton
      playthroughId={playthrough.id}
      currentPhase={playthrough.current_phase}
    />
  );

  switch (playthrough.current_phase) {
    case "top_of_day":
      return (
        <div className="flex flex-col gap-6">
          {/* TODO: extract MiddleItem builder from morning-report-editor.tsx
                so we can pass real items here. For now we render only the
                intro + sign-off via empty items. */}
          <PhaseTopOfDay
            day={currentDay}
            items={[]}
            actions={[]}
            templates={[]}
            chosenActionByLetter={{}}
          />
          <div className="flex justify-end">{advanceButton}</div>
        </div>
      );
    case "sorting":
      return (
        <div className="flex flex-col gap-6">
          <PhaseSorting
            day={currentDay}
            rules={sortingPhaseData.rules}
            conditionsByRule={sortingPhaseData.conditionsByRule}
            phaseTimer={
              <PhaseTimer playthrough={playthrough} currentDay={currentDay} />
            }
          />
          <div className="flex justify-end">{advanceButton}</div>
        </div>
      );
    case "inspection":
      return (
        <div className="flex flex-col gap-6">
          <PhaseInspection
            day={currentDay}
            playthroughId={playthrough.id}
            letters={inspectionPhaseData.letters}
            actionsByLetter={inspectionPhaseData.actionsByLetter}
            templates={inspectionPhaseData.templates}
            chosenActionByLetter={inspectionPhaseData.chosenActionByLetter}
            storylines={inspectionPhaseData.storylines}
            phaseTimer={
              <PhaseTimer playthrough={playthrough} currentDay={currentDay} />
            }
          />
          <div className="flex justify-end">{advanceButton}</div>
        </div>
      );
    case "end_of_day":
      // PhaseEndOfDay hosts its own "Next day" button.
      return (
        <PhaseEndOfDay
          playthroughId={playthrough.id}
          day={currentDay}
          vars={vars}
        />
      );
  }
}

/** Pre-game gate. Shows a "Start playthrough" button until `started=true`. */
function StartGate({ playthrough }: { playthrough: Playthrough }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-center gap-4 rounded-md border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">
        This playthrough hasn&apos;t been started yet.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await startPlaythrough(playthrough.id);
          })
        }
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Starting…" : "Start playthrough"}
        <ArrowRight size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Shared "Next phase" button used by TOD / sorting / inspection (EOD has
 *  its own labeled "Next day" button). */
function AdvancePhaseButton({
  playthroughId,
  currentPhase,
}: {
  playthroughId: string;
  currentPhase: Playthrough["current_phase"];
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await advancePhase(playthroughId, currentPhase);
        })
      }
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
    >
      {pending ? "Advancing…" : "Next phase"}
      <ArrowRight size={16} aria-hidden />
    </button>
  );
}
