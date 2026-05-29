"use client";

import { PHASE_LABELS, type Phase } from "@/lib/db/enums";
import { VARIABLE_LABELS } from "@/lib/playthrough/variables";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  Playthrough,
  PlaythroughActionChoice,
  PlaythroughPhaseLog,
  PlaythroughVariables,
} from "@/lib/db/types";

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDiff(elapsed: number, allotted: number | null): string {
  if (allotted == null) return formatMs(elapsed);
  const diff = elapsed - allotted;
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  return `${formatMs(elapsed)} / ${formatMs(allotted)} (${sign}${formatMs(Math.abs(diff))})`;
}

interface FiredSegment {
  report_segment_id: string;
  day_id: string;
  summary: string | null;
  report_id: string | null;
}

export function FinalLog({
  playthrough,
  days,
  phaseLogs,
  vars,
  choices,
  actions,
  templates,
  firedSegments,
  frameworkName,
}: {
  playthrough: Playthrough;
  days: Day[];
  phaseLogs: PlaythroughPhaseLog[];
  vars: PlaythroughVariables | null;
  choices: PlaythroughActionChoice[];
  actions: ActionRow[];
  templates: ActionTemplate[];
  firedSegments: FiredSegment[];
  frameworkName: string | null;
}) {
  const dayById = new Map(days.map((d) => [d.id, d]));
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const actionById = new Map(actions.map((a) => [a.id, a]));

  // Total elapsed from game clock.
  const totalElapsed =
    playthrough.started_at != null
      ? Date.now() -
        new Date(playthrough.started_at).getTime() -
        playthrough.total_paused_ms
      : 0;

  // Group phase logs by day.
  const logsByDay = new Map<string, PlaythroughPhaseLog[]>();
  for (const log of phaseLogs) {
    const arr = logsByDay.get(log.day_id) ?? [];
    arr.push(log);
    logsByDay.set(log.day_id, arr);
  }

  // Ordered unique day IDs from logs.
  const logDayIds = [...new Set(phaseLogs.map((l) => l.day_id))];
  const sortedDayIds = logDayIds.sort((a, b) => {
    const da = dayById.get(a);
    const db = dayById.get(b);
    return (da?.number ?? 0) - (db?.number ?? 0);
  });

  // Segment rollups by day.
  const segmentsByDay = new Map<string, FiredSegment[]>();
  for (const seg of firedSegments) {
    const arr = segmentsByDay.get(seg.day_id) ?? [];
    arr.push(seg);
    segmentsByDay.set(seg.day_id, arr);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Playthrough Log
        </div>
        <p className="text-sm text-muted-foreground">
          Total elapsed:{" "}
          <span className="font-mono font-medium text-foreground">
            {formatMs(Math.max(0, totalElapsed))}
          </span>
        </p>
      </div>

      {/* Per-day breakdown */}
      {sortedDayIds.map((dayId) => {
        const day = dayById.get(dayId);
        if (!day) return null;
        const logs = logsByDay.get(dayId) ?? [];
        const daySegments = segmentsByDay.get(dayId) ?? [];

        return (
          <div
            key={dayId}
            className="rounded-md border border-border bg-card/50 p-4"
          >
            <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {day.identifier}
              {day.name ? ` — ${day.name}` : ""}
            </p>

            {/* Phase rows */}
            <div className="flex flex-col gap-2">
              {(["top_of_day", "sorting", "inspection", "end_of_day"] as Phase[]).map(
                (phase) => {
                  const log = logs.find((l) => l.phase === phase);
                  if (!log) return null;
                  return (
                    <div
                      key={phase}
                      className="flex items-baseline justify-between text-xs"
                    >
                      <span className="text-muted-foreground">
                        {PHASE_LABELS[phase]}
                      </span>
                      <span className="font-mono text-foreground">
                        {log.elapsed_ms != null
                          ? formatDiff(log.elapsed_ms, log.allotted_ms ?? null)
                          : "—"}
                      </span>
                    </div>
                  );
                }
              )}
            </div>

            {/* Fired report segments for this day's TOD */}
            {daySegments.length > 0 ? (
              <div className="mt-3 border-t border-border pt-2">
                <p className="mb-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                  Morning Reports
                </p>
                <ul className="flex flex-col gap-0.5">
                  {daySegments.map((seg) => (
                    <li
                      key={seg.report_segment_id}
                      className="text-xs text-muted-foreground"
                    >
                      {seg.report_id ? (
                        <span className="font-mono text-[10px] mr-1">
                          {seg.report_id}
                        </span>
                      ) : null}
                      {seg.summary ?? "—"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Impact per action */}
      {choices.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Action Choices
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Action</th>
                  <th className="py-1 pr-2 font-medium font-mono text-[10px]">
                    Fallback
                  </th>
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
                    ] as const
                  ).map((col) => (
                    <th
                      key={col}
                      className="py-1 px-1 font-medium font-mono text-[9px] text-center"
                    >
                      {VARIABLE_LABELS[col]?.slice(0, 4)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {choices.map((c) => {
                  const action = actionById.get(c.chosen_action_id);
                  const tpl = action?.action_template_id
                    ? templateById.get(action.action_template_id)
                    : null;
                  return (
                    <tr key={c.id} className="border-b border-border/30">
                      <td className="py-1 pr-3 text-foreground">
                        {tpl?.name ?? "—"}
                      </td>
                      <td className="py-1 pr-2 text-center">
                        {c.applied_via_fallback ? (
                          <span className="text-amber-400 text-[10px]">F</span>
                        ) : null}
                      </td>
                      {(
                        [
                          "impact_world_status",
                          "impact_demerits",
                          "impact_proletariat",
                          "impact_gentry",
                          "impact_epicenter",
                          "impact_folos",
                          "impact_emberlyn",
                          "impact_spokgrad",
                          "impact_pelico",
                        ] as const
                      ).map((col) => {
                        const val = action?.[col] ?? 0;
                        return (
                          <td
                            key={col}
                            className={`py-1 px-1 text-center font-mono text-[10px] ${
                              val > 0
                                ? "text-green-400"
                                : val < 0
                                  ? "text-red-400"
                                  : "text-muted-foreground/40"
                            }`}
                          >
                            {val !== 0 ? (val > 0 ? `+${val}` : val) : "·"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Final tally */}
      {vars ? (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Final Tally
          </p>
          <div className="grid grid-cols-5 gap-2">
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
            ).map((key) => (
              <div
                key={key}
                className="flex flex-col gap-0.5 rounded-md border border-border px-2 py-1.5"
              >
                <span className="font-mono text-[9px] text-muted-foreground truncate">
                  {VARIABLE_LABELS[key]}
                </span>
                <span
                  className={`font-mono text-xs font-semibold ${
                    vars[key] > 0
                      ? "text-green-400"
                      : vars[key] < 0
                        ? "text-red-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {vars[key] > 0 ? "+" : ""}
                  {vars[key]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Ending */}
      {frameworkName ? (
        <div className="rounded-md border border-border bg-card/50 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            Ending
          </p>
          <p className="text-sm font-medium text-foreground">
            {frameworkName}
          </p>
        </div>
      ) : null}
    </div>
  );
}
