"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBreadcrumbExtension } from "@/lib/breadcrumb-context";
import {
  usePresenceContext,
  WorkspacePresenceProvider,
} from "@/lib/realtime/presence-context";
import type { PresenceProfile } from "@/lib/realtime/presence";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  DayReportBlockView,
  InspectionLetterView,
  LetterGroup,
  ReportGroup,
  ReportSegmentView,
  Storyline,
} from "@/lib/db/types";
import { DayList } from "./day-list";
import { MorningReportEditor } from "./morning-report-editor";

type WorkspaceData = {
  days: Day[];
  dayBlocks: DayReportBlockView[];
  segments: ReportSegmentView[];
  letterGroups: LetterGroup[];
  reportGroups: ReportGroup[];
  storylines: Storyline[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  templates: ActionTemplate[];
};

export function MorningReportsWorkspace({
  selectedDayIdentifier,
  currentUserId,
  currentEmail,
  currentProfile,
  ...data
}: WorkspaceData & {
  selectedDayIdentifier: string | null;
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="morning-reports"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={[
        "day_report_blocks",
        "report_segments",
        "days",
        "letter_groups",
        "actions",
        "inspection_letters",
      ]}
    >
      <MorningReportsWorkspaceInner
        data={data}
        selectedDayIdentifier={selectedDayIdentifier}
      />
    </WorkspacePresenceProvider>
  );
}

function MorningReportsWorkspaceInner({
  data,
  selectedDayIdentifier,
}: {
  data: WorkspaceData;
  selectedDayIdentifier: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSelection } = usePresenceContext();

  const effectiveDay = useMemo(
    () =>
      data.days.find((d) => d.identifier === selectedDayIdentifier) ??
      data.days[0] ??
      null,
    [data.days, selectedDayIdentifier]
  );
  const previousDay = useMemo(
    () =>
      effectiveDay
        ? data.days.find((d) => d.number === effectiveDay.number - 1) ?? null
        : null,
    [data.days, effectiveDay]
  );

  useBreadcrumbExtension(effectiveDay ? [effectiveDay.identifier] : []);

  const effectiveDayId = effectiveDay?.id ?? null;
  useEffect(() => {
    setSelection({
      storylineId: null,
      groupId: null,
      letterId: null,
      segmentId: null,
      view: "morning-reports",
      payload: { morningReportDayId: effectiveDayId },
    });
  }, [effectiveDayId, setSelection]);

  // The day list passes a day id; the URL carries the human identifier
  // (e.g. ?day=D2) so the address bar stays readable.
  function navigateTo(dayId: string) {
    const day = data.days.find((d) => d.id === dayId);
    const qs = new URLSearchParams(searchParams?.toString() ?? "");
    qs.set("day", day?.identifier ?? dayId);
    router.push(`/top-of-day/morning-reports?${qs.toString()}`);
  }

  const dayBlocksForDay = useMemo(
    () =>
      effectiveDay
        ? data.dayBlocks.filter((b) => b.day_id === effectiveDay.id)
        : [],
    [data.dayBlocks, effectiveDay]
  );

  return (
    <div className="grid gap-3 md:grid-cols-[240px_1fr]">
      <DayList
        days={data.days}
        selectedId={effectiveDayId}
        onSelect={navigateTo}
      />
      {effectiveDay ? (
        <MorningReportEditor
          key={effectiveDay.id}
          day={effectiveDay}
          previousDay={previousDay}
          blocks={dayBlocksForDay}
          segments={data.segments}
          letterGroups={data.letterGroups}
          reportGroups={data.reportGroups}
          storylines={data.storylines}
          letters={data.letters}
          actions={data.actions}
          templates={data.templates}
        />
      ) : (
        <div className="rounded-md border border-border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          No days exist yet — create days first.
        </div>
      )}
    </div>
  );
}
