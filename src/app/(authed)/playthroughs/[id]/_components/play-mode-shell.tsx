"use client";

import { useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { WorkspacePresenceProvider } from "@/lib/realtime/presence-context";
import type { PresenceProfile } from "@/lib/realtime/presence";
import { usePlaythroughSync } from "@/lib/playthrough/use-playthrough-sync";
import { PHASES, type Phase } from "@/lib/db/enums";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  Playthrough,
  PlaythroughActionChoice,
  PlaythroughPhaseLog,
  PlaythroughVariables,
  SortingRule,
  SortingRuleCondition,
  Storyline,
} from "@/lib/db/types";
import { advancePhase, goToPhase, startPlaythrough } from "../_actions/play-actions";
import { FinalLog } from "./final-log";
import { PhaseEndOfDay } from "./phase-end-of-day";
import { PhaseEnding } from "./phase-ending";
import { PhaseInspection, type DeliveredLetterWithFallback } from "./phase-inspection";
import { PhaseNav } from "./phase-nav";
import { PhaseSorting } from "./phase-sorting";
import { PhaseTimer } from "./phase-timer";
import { PhaseTopOfDay } from "./phase-top-of-day";
import { PlayNavbar } from "./play-navbar";
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

type EndingData = {
  frameworkName: string | null;
  paragraphs: string[];
  choices: PlaythroughActionChoice[];
  actions: ActionRow[];
  templates: ActionTemplate[];
  firedSegments: { report_segment_id: string; day_id: string; summary: string | null; report_id: string | null }[];
};

/** Top-level client wrapper for the play-mode surface. Opens the per-
 *  playthrough realtime channel (`playthrough:<id>`) so the navbar's
 *  AvatarStack + Track A timers sync across tabs. */
export function PlayModeShell({
  playthrough,
  currentDay,
  vars,
  mapImageUrl,
  days,
  phaseLogs,
  sortingPhaseData,
  inspectionPhaseData,
  endingData,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  playthrough: Playthrough;
  currentDay: Day | null;
  vars: PlaythroughVariables | null;
  mapImageUrl: string | null;
  days: Day[];
  phaseLogs: PlaythroughPhaseLog[];
  sortingPhaseData: SortingPhaseData;
  inspectionPhaseData: InspectionPhaseData;
  endingData: EndingData | null;
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
        days={days}
        phaseLogs={phaseLogs}
        sortingPhaseData={sortingPhaseData}
        inspectionPhaseData={inspectionPhaseData}
        endingData={endingData}
      />
    </WorkspacePresenceProvider>
  );
}

// ---------------------------------------------------------------------------
// Helpers for furthest comparison
// ---------------------------------------------------------------------------

function isBeforeFurthest(
  currentDayNumber: number,
  currentPhase: Phase,
  furthestDayNumber: number | null,
  furthestPhase: Phase | null
): boolean {
  if (furthestDayNumber == null || !furthestPhase) return false;
  if (currentDayNumber < furthestDayNumber) return true;
  if (currentDayNumber === furthestDayNumber) {
    return PHASES.indexOf(currentPhase) < PHASES.indexOf(furthestPhase);
  }
  return false;
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
  days,
  phaseLogs,
  sortingPhaseData,
  inspectionPhaseData,
  endingData,
}: {
  playthrough: Playthrough;
  currentDay: Day | null;
  vars: PlaythroughVariables | null;
  mapImageUrl: string | null;
  days: Day[];
  phaseLogs: PlaythroughPhaseLog[];
  sortingPhaseData: SortingPhaseData;
  inspectionPhaseData: InspectionPhaseData;
  endingData: EndingData | null;
}) {
  usePlaythroughSync(playthrough.id);

  // --- URL state: sync ?day=<number>&phase=<phase> with playthrough cursor ---
  const router = useRouter();
  const searchParams = useSearchParams();

  // On mount: if URL params disagree with the playthrough cursor and the
  // target is reachable (at or before furthest), jump to it once.
  useEffect(() => {
    const dayParam = searchParams.get("day");
    const phaseParam = searchParams.get("phase") as Phase | null;
    if (!dayParam || !phaseParam) return;
    const targetDayNum = parseInt(dayParam, 10);
    if (isNaN(targetDayNum)) return;
    const targetDay = days.find((d) => d.number === targetDayNum);
    if (!targetDay || !PHASES.includes(phaseParam)) return;

    const alreadyThere =
      targetDay.id === playthrough.current_day_id &&
      phaseParam === playthrough.current_phase;
    if (alreadyThere) return;

    const furthestDay = days.find((d) => d.id === playthrough.furthest_day_id);
    const reachable =
      !furthestDay ||
      !playthrough.furthest_phase ||
      !isBeforeFurthest(
        targetDayNum,
        phaseParam,
        furthestDay.number,
        playthrough.furthest_phase
      ) === false;

    // Target must be at or before furthest to be reachable
    const targetBeforeOrAtFurthest =
      !furthestDay ||
      !playthrough.furthest_phase ||
      targetDayNum < furthestDay.number ||
      (targetDayNum === furthestDay.number &&
        PHASES.indexOf(phaseParam) <= PHASES.indexOf(playthrough.furthest_phase));

    if (targetBeforeOrAtFurthest && playthrough.started) {
      goToPhase(playthrough.id, targetDay.id, phaseParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep URL in sync with cursor changes.
  useEffect(() => {
    if (!currentDay) return;
    const url = new URL(window.location.href);
    url.searchParams.set("day", String(currentDay.number));
    url.searchParams.set("phase", playthrough.current_phase);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [currentDay, playthrough.current_phase, router]);

  // --- Determine if at past phase (for hiding advance button / disabling timer) ---
  const furthestDay = days.find((d) => d.id === playthrough.furthest_day_id);
  const atPastPhase =
    currentDay != null &&
    isBeforeFurthest(
      currentDay.number,
      playthrough.current_phase,
      furthestDay?.number ?? null,
      playthrough.furthest_phase
    );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PlayNavbar
        playthrough={playthrough}
        currentDay={currentDay}
        vars={vars}
        phaseNav={
          currentDay && playthrough.started ? (
            <PhaseNav
              playthrough={playthrough}
              currentDay={currentDay}
              days={days}
              phaseLogs={phaseLogs}
            />
          ) : null
        }
      />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        {playthrough.ended && endingData ? (
          <div className="flex flex-col gap-10">
            <PhaseEnding
              frameworkName={endingData.frameworkName}
              paragraphs={endingData.paragraphs}
              vars={vars}
            />
            <FinalLog
              playthrough={playthrough}
              days={days}
              phaseLogs={phaseLogs}
              vars={vars}
              choices={endingData.choices}
              actions={endingData.actions}
              templates={endingData.templates}
              firedSegments={endingData.firedSegments}
              frameworkName={endingData.frameworkName}
            />
          </div>
        ) : (
          <PhaseContent
            playthrough={playthrough}
            currentDay={currentDay}
            vars={vars}
            days={days}
            phaseLogs={phaseLogs}
            atPastPhase={atPastPhase}
            sortingPhaseData={sortingPhaseData}
            inspectionPhaseData={inspectionPhaseData}
          />
        )}
      </main>
      <ReferencePanel mapImageUrl={mapImageUrl} />
    </div>
  );
}

/** Phase router. Switches on `playthrough.current_phase` and feeds each
 *  component its slice of pre-resolved data. When `atPastPhase` is true
 *  the "Next phase" advance button is hidden (the player uses PhaseNav's
 *  forward button to step through history instead). */
function PhaseContent({
  playthrough,
  currentDay,
  vars,
  days,
  phaseLogs,
  atPastPhase,
  sortingPhaseData,
  inspectionPhaseData,
}: {
  playthrough: Playthrough;
  currentDay: Day | null;
  vars: PlaythroughVariables | null;
  days: Day[];
  phaseLogs: PlaythroughPhaseLog[];
  atPastPhase: boolean;
  sortingPhaseData: SortingPhaseData;
  inspectionPhaseData: InspectionPhaseData;
}) {
  // Pre-game state: no current day, or `started` is false.
  if (!playthrough.started || !currentDay) {
    return <StartGate playthrough={playthrough} />;
  }

  const advanceButton = atPastPhase ? null : (
    <AdvancePhaseButton
      playthroughId={playthrough.id}
      currentPhase={playthrough.current_phase}
    />
  );

  switch (playthrough.current_phase) {
    case "top_of_day":
      return (
        <div className="flex flex-col gap-6">
          <PhaseTopOfDay
            day={currentDay}
            items={[]}
            actions={[]}
            templates={[]}
            chosenActionByLetter={{}}
          />
          {advanceButton ? (
            <div className="flex justify-end">{advanceButton}</div>
          ) : null}
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
              <PhaseTimer
                playthrough={playthrough}
                currentDay={currentDay}
                disabled={atPastPhase}
              />
            }
          />
          {advanceButton ? (
            <div className="flex justify-end">{advanceButton}</div>
          ) : null}
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
              <PhaseTimer
                playthrough={playthrough}
                currentDay={currentDay}
                disabled={atPastPhase}
              />
            }
          />
          {advanceButton ? (
            <div className="flex justify-end">{advanceButton}</div>
          ) : null}
        </div>
      );
    case "end_of_day": {
      const maxDayNum = Math.max(...days.map((d) => d.number));
      return (
        <PhaseEndOfDay
          playthroughId={playthrough.id}
          day={currentDay}
          vars={vars}
          hideAdvance={atPastPhase}
          isFinalDay={currentDay.number === maxDayNum}
        />
      );
    }
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
