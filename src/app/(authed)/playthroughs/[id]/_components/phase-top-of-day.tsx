// C1 — Top-of-Day phase content.
//
// Renders the morning report in read-only mode, driven by the playthrough's
// actual action choices (frozen snapshot — not the interactive simulator from
// the morning-report editor). Does NOT render the per-letter-group simulation
// controls; those belong to the editor surface only.

import { RichTextReadonly } from "@/components/rich-text/rich-text-readonly";
import {
  LetterGroupPill,
  ReportSegmentPill,
} from "@/components/pills";
import { selectFiredReportSegments } from "@/lib/playthrough/select-fired-segments";
import type {
  ActionRow,
  ActionTemplate,
  Day,
} from "@/lib/db/types";
import type { MiddleItem } from "@/app/(authed)/top-of-day/morning-reports/_lib/middle-item";

// ── MorningReportSummary ─────────────────────────────────────────────────────

/**
 * Read-only morning-report renderer for play mode.
 *
 * Props mirror the data PreviewView uses, minus the interactive simulation
 * controls. `chosenActionByLetter` is a map of inspection_letter_id →
 * chosen_action_id that comes from `playthrough_action_choices` (already
 * resolved by the server component for the current playthrough + day).
 */
export function MorningReportSummary({
  day,
  items,
  actions,
  templates,
  chosenActionByLetter,
}: {
  day: Day;
  /** The ordered middle section (generic blocks + letter-group blocks). */
  items: MiddleItem[];
  /** All actions for letters delivering on this day. */
  actions: ActionRow[];
  templates: ActionTemplate[];
  /** Frozen choices: inspection_letter_id → chosen_action_id. */
  chosenActionByLetter: Record<string, string>;
}) {
  const templatesById = new Map(templates.map((t) => [t.id, t]));

  // Derive the set of fired report segments from the playthrough's choices.
  const firedSegmentIds = selectFiredReportSegments(actions, chosenActionByLetter);

  function resolveAction(a: ActionRow) {
    const tpl = a.action_template_id
      ? templatesById.get(a.action_template_id)
      : undefined;
    return {
      name: tpl?.name ?? "Unset action",
      colorHex: tpl?.color_hex ?? "#3f3f46",
    };
  }

  return (
    <div className="flex flex-col gap-3">
      <ReportBlock label="Intro" body={day.base_report} />
      {items.map((it) => {
        if (it.kind === "generic") {
          return (
            <ReportCard
              key={it.dragId}
              pill={
                <ReportSegmentPill
                  storyline={undefined}
                  reportId={it.block.report_id ?? ""}
                />
              }
              summary={it.block.summary}
              body={it.block.content}
            />
          );
        }

        // Letter-group block: find fired segments and the chosen action context.
        const fired = it.segments.filter((s) => firedSegmentIds.has(s.id));

        // Find which action was chosen for a letter in this group (for placeholder label).
        const chosenEntry = Object.entries(chosenActionByLetter).find(
          ([, actionId]) => {
            const act = actions.find((a) => a.id === actionId);
            return act && it.segments.some((s) => s.id === act.report_segment_id);
          }
        );
        const chosenAction = chosenEntry
          ? actions.find((a) => a.id === chosenEntry[1])
          : undefined;
        const resolved = chosenAction ? resolveAction(chosenAction) : null;

        if (fired.length === 0) {
          return (
            <div
              key={it.dragId}
              className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card/40 p-3"
            >
              <LetterGroupPill
                storyline={it.storyline}
                sequence={it.letterGroup.sequence}
              />
              <span className="text-xs italic text-muted-foreground/50">
                {resolved
                  ? `Action: "${resolved.name}" — no report segment.`
                  : "No action chosen — report not generated."}
              </span>
            </div>
          );
        }

        return (
          <div key={it.dragId} className="flex flex-col gap-3">
            {fired.map((s) => (
              <ReportCard
                key={s.id}
                pill={
                  <ReportSegmentPill
                    storyline={it.storyline}
                    reportId={s.report_id}
                  />
                }
                summary={s.summary}
                body={s.content}
              />
            ))}
          </div>
        );
      })}
      <ReportBlock label="Sign-off" body={day.report_sign_off} />
    </div>
  );
}

// ── Phase-level wrapper ───────────────────────────────────────────────────────

/**
 * C1 — Top-of-Day phase. Server-friendly (no "use client"). Accepts
 * pre-resolved data from the page server component; renders in read-only mode.
 */
export function PhaseTopOfDay({
  day,
  items,
  actions,
  templates,
  chosenActionByLetter,
}: {
  day: Day;
  items: MiddleItem[];
  actions: ActionRow[];
  templates: ActionTemplate[];
  chosenActionByLetter: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Top of Day — Morning Report
        </div>
        <p className="text-xs text-muted-foreground/70">
          The morning report for{" "}
          <span className="font-semibold text-foreground/80">
            {day.identifier}
          </span>
          {day.name ? ` — ${day.name}` : ""}, based on choices made during
          the previous day&apos;s inspection.
        </p>
      </div>

      <MorningReportSummary
        day={day}
        items={items}
        actions={actions}
        templates={templates}
        chosenActionByLetter={chosenActionByLetter}
      />
    </div>
  );
}

// ── Shared sub-components (read-only report card primitives) ─────────────────

function ReportBodyText({ body }: { body: string | null }) {
  return (
    <RichTextReadonly
      value={body}
      className="min-h-[3rem] rounded-md bg-[var(--block-result-bg)] px-3 py-2 font-mono text-sm text-foreground"
      emptyFallback={
        <span className="italic text-muted-foreground/50">(empty)</span>
      }
    />
  );
}

function ReportBlock({ label, body }: { label: string; body: string | null }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <ReportBodyText body={body} />
    </div>
  );
}

function ReportCard({
  pill,
  summary,
  body,
}: {
  pill: React.ReactNode;
  summary: string | null;
  body: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        {pill}
        {summary ? (
          <span className="text-xs text-muted-foreground">{summary}</span>
        ) : null}
      </div>
      <ReportBodyText body={body} />
    </div>
  );
}
