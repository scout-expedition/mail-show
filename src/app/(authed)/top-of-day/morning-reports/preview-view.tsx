"use client";

// Morning-report preview. Per previous-day letter group the author picks
// the one letter that was delivered and the one action taken; the chosen
// actions resolve to report segments and the panel renders the resulting
// morning report. Pure local state — no writes.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { FlashRing } from "@/lib/realtime/flash-ring";
import {
  ActionPill,
  InspectionLetterPill,
  LetterGroupPill,
  ReportSegmentPill,
} from "@/components/pills";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  InspectionLetterView,
} from "@/lib/db/types";
import type { MiddleItem } from "./_lib/middle-item";

export function PreviewView({
  day,
  previousDay,
  items,
  letters,
  actions,
  templates,
  selectedLetter,
  selectedAction,
  onSelectionChange,
  flashes,
}: {
  day: Day;
  previousDay: Day | null;
  items: MiddleItem[];
  letters: InspectionLetterView[];
  actions: ActionRow[];
  templates: ActionTemplate[];
  /** Per-letter-group simulation picks, owned + synced by the editor. */
  selectedLetter: Record<string, string>;
  selectedAction: Record<string, string>;
  onSelectionChange: (patch: {
    selectedLetter?: Record<string, string>;
    selectedAction?: Record<string, string>;
  }) => void;
  /** Transient peer-change highlights, keyed `letter:<groupId>` /
   *  `action:<groupId>`. From the editor's useFlash. */
  flashes: Record<string, string>;
}) {
  const templatesById = useMemo(
    () => new Map(templates.map((t) => [t.id, t])),
    [templates]
  );

  // Letter groups in the same order they appear on the page.
  const lgItems = useMemo(
    () =>
      items.filter(
        (it): it is Extract<MiddleItem, { kind: "letter_group" }> =>
          it.kind === "letter_group"
      ),
    [items]
  );

  const lettersByLG = useMemo(() => {
    const m = new Map<string, InspectionLetterView[]>();
    for (const l of letters) {
      const arr = m.get(l.letter_group_id) ?? [];
      arr.push(l);
      m.set(l.letter_group_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          (a.variant ?? "").localeCompare(b.variant ?? "") ||
          (a.piece ?? 0) - (b.piece ?? 0)
      );
    }
    return m;
  }, [letters]);

  const actionsByLetter = useMemo(() => {
    const m = new Map<string, ActionRow[]>();
    for (const a of actions) {
      const arr = m.get(a.inspection_letter_id) ?? [];
      arr.push(a);
      m.set(a.inspection_letter_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [actions]);

  // Per letter group: the one delivered letter + the one chosen action.
  // State lives in the editor (so it can be synced across users); this view
  // reads it from props and reports changes via onSelectionChange. Each
  // change touches only its own group's entry — "" means cleared (an
  // entry-level patch can't express a key deletion).
  function selectLetter(groupId: string, letterId: string) {
    if (selectedLetter[groupId] === letterId) {
      // Clicking the selected letter clears it (and its action).
      onSelectionChange({
        selectedLetter: { [groupId]: "" },
        selectedAction: { [groupId]: "" },
      });
      return;
    }
    // Switching letters — carry the chosen action over if the new letter
    // has an equivalent one (same template, else same name); else clear.
    const prevAction = selectedAction[groupId]
      ? actions.find((a) => a.id === selectedAction[groupId])
      : undefined;
    let carried = "";
    if (prevAction) {
      const match = (actionsByLetter.get(letterId) ?? []).find(
        (a) =>
          prevAction.action_template_id != null &&
          a.action_template_id === prevAction.action_template_id
      );
      if (match) carried = match.id;
    }
    onSelectionChange({
      selectedLetter: { [groupId]: letterId },
      selectedAction: { [groupId]: carried },
    });
  }

  function toggleAction(groupId: string, actionId: string) {
    const next = selectedAction[groupId] === actionId ? "" : actionId;
    onSelectionChange({ selectedAction: { [groupId]: next } });
  }

  const firedSegmentIds = useMemo(() => {
    const set = new Set<string>();
    for (const actionId of Object.values(selectedAction)) {
      const act = actions.find((a) => a.id === actionId);
      if (act?.report_segment_id) set.add(act.report_segment_id);
    }
    return set;
  }, [selectedAction, actions]);

  function resolveAction(a: ActionRow) {
    const tpl = a.action_template_id
      ? templatesById.get(a.action_template_id)
      : undefined;
    return {
      name: tpl?.name ?? "Unset action",
      iconType: tpl?.icon_type ?? null,
      iconValue: tpl?.icon_value ?? null,
      colorHex: tpl?.color_hex ?? "#3f3f46",
    };
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* Simulation controls — one box holding every letter group */}
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Simulate delivery{previousDay ? ` — ${previousDay.identifier}` : ""}
        </div>
        {!previousDay ? (
          <p className="text-xs italic text-muted-foreground/60">
            {day.identifier} has no previous day — no letters feed this morning
            report.
          </p>
        ) : lgItems.length === 0 ? (
          <p className="text-xs italic text-muted-foreground/60">
            No letter groups deliver reports on {day.identifier}.
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-2">
            {lgItems.map((it) => {
              const groupId = it.letterGroup.id;
              const groupLetters = lettersByLG.get(groupId) ?? [];
              const pickedLetterId = selectedLetter[groupId];
              const pickedLetter = pickedLetterId
                ? groupLetters.find((l) => l.id === pickedLetterId)
                : undefined;
              const letterActions = pickedLetterId
                ? actionsByLetter.get(pickedLetterId) ?? []
                : [];
              const pickedActionId = selectedAction[groupId];
              return (
                <div
                  key={groupId}
                  className="flex flex-col gap-1.5 rounded-md border border-border p-2"
                >
                  <div className="flex items-center gap-1.5">
                    <LetterGroupPill
                      storyline={it.storyline}
                      sequence={it.letterGroup.sequence}
                    />
                    <span className="truncate text-xs text-muted-foreground">
                      - {it.letterGroup.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <FlashRing color={flashes[`letter:${groupId}`]}>
                    <div className="flex flex-wrap items-center gap-1">
                      {groupLetters.length === 0 ? (
                        <span className="text-xs italic text-muted-foreground/50">
                          No letters in this group.
                        </span>
                      ) : (
                        groupLetters.map((l) => {
                          const picked = pickedLetterId === l.id;
                          return (
                            <button
                              key={l.id}
                              type="button"
                              onClick={() => selectLetter(groupId, l.id)}
                              className={cn(
                                "rounded-md transition-opacity",
                                picked
                                  ? "opacity-100"
                                  : "opacity-40 hover:opacity-75"
                              )}
                            >
                              <InspectionLetterPill
                                storyline={it.storyline}
                                contentId={l.content_id}
                              />
                            </button>
                          );
                        })
                      )}
                    </div>
                    </FlashRing>
                    {pickedLetter?.summary ? (
                      <span className="min-w-0 flex-1 truncate text-[10px] italic text-muted-foreground/70">
                        {pickedLetter.summary}
                      </span>
                    ) : null}
                    {letterActions.length > 0 ? (
                      <FlashRing
                        color={flashes[`action:${groupId}`]}
                        className="ml-auto"
                      >
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {letterActions.map((a) => {
                          const ra = resolveAction(a);
                          const picked = pickedActionId === a.id;
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => toggleAction(groupId, a.id)}
                              className={cn(
                                "rounded-md transition-opacity",
                                picked
                                  ? "opacity-100"
                                  : "opacity-40 hover:opacity-75"
                              )}
                            >
                              <ActionPill
                                name={ra.name}
                                iconType={ra.iconType ?? "lucide"}
                                iconValue={ra.iconValue}
                                colorHex={ra.colorHex}
                                iconOnly
                              />
                            </button>
                          );
                        })}
                      </div>
                      </FlashRing>
                    ) : pickedLetter ? (
                      <span className="ml-auto text-xs italic text-muted-foreground/50">
                        No actions on {pickedLetter.content_id}.
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rendered morning report */}
      <div className="flex flex-col gap-3">
        <PreviewText label="Intro" body={day.base_report} />
        {items.map((it) => {
          if (it.kind === "generic") {
            return (
              <PreviewReport
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
          const fired = it.segments.filter((s) => firedSegmentIds.has(s.id));
          // Until a letter + action resolves a segment for this group,
          // hold its slot with a placeholder.
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
                  Report pending — pick a delivered letter and action above.
                </span>
              </div>
            );
          }
          return (
            <div key={it.dragId} className="flex flex-col gap-3">
              {fired.map((s) => (
                <PreviewReport
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
        <PreviewText label="Sign-off" body={day.report_sign_off} />
      </div>
    </div>
  );
}

function PreviewBody({ body }: { body: string | null }) {
  const empty = !body || body.trim() === "";
  return (
    <pre className="m-0 min-h-[3rem] whitespace-pre-wrap rounded-md bg-[var(--block-result-bg)] px-3 py-2 font-mono text-sm text-foreground">
      {empty ? (
        <span className="italic text-muted-foreground/50">(empty)</span>
      ) : (
        body
      )}
    </pre>
  );
}

function PreviewText({ label, body }: { label: string; body: string | null }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <PreviewBody body={body} />
    </div>
  );
}

function PreviewReport({
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
      <PreviewBody body={body} />
    </div>
  );
}
