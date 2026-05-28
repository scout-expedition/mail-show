"use client";

// C3 — Inspection phase content.
//
// Queries playthrough_delivered_letters_view filtered by playthrough_id
// (pre-fetched by the page server component; passed in as props).
//
// Each letter renders as a collapsible rectangle showing recipient, sender,
// and content_id badge. Clicking expands the letter content (RichTextReadonly).
// The action chooser wires directly to the existing chooseAction/clearChoice
// server actions.
//
// Letters whose inspection_letter has fallback_mirror_action_id set display a
// muted "Fallback: <action name>" hint under the action row.

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { RichTextReadonly } from "@/components/rich-text/rich-text-readonly";
import {
  ActionPill,
  InspectionLetterPill,
} from "@/components/pills";
import type {
  ActionRow,
  ActionTemplate,
  Day,
  PlaythroughDeliveredLetter,
  Storyline,
} from "@/lib/db/types";
import { chooseAction, clearChoice } from "../_actions/play-actions";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A letter enriched with its fallback action (if any), resolved from the
 *  fallback_mirror_action_id. */
export interface DeliveredLetterWithFallback extends PlaythroughDeliveredLetter {
  /** Name of the action referenced by fallback_mirror_action_id (resolved
   *  by the server component). Null when no fallback is configured. */
  fallback_action_name: string | null;
  fallback_action_color_hex: string | null;
  fallback_action_icon_type: string | null;
  fallback_action_icon_value: string | null;
}

// ── Action chooser ────────────────────────────────────────────────────────────

function resolveAction(a: ActionRow, templates: ActionTemplate[]) {
  const tpl = a.action_template_id
    ? templates.find((t) => t.id === a.action_template_id)
    : undefined;
  return {
    name: tpl?.name ?? "Unset action",
    iconType: (tpl?.icon_type ?? "lucide") as ActionTemplate["icon_type"],
    iconValue: tpl?.icon_value ?? null,
    colorHex: tpl?.color_hex ?? "#3f3f46",
  };
}

function ActionChooser({
  playthroughId,
  letterId,
  actions,
  templates,
  chosenActionId,
  fallbackActionName,
  fallbackColorHex,
}: {
  playthroughId: string;
  letterId: string;
  actions: ActionRow[];
  templates: ActionTemplate[];
  chosenActionId: string | undefined;
  fallbackActionName: string | null;
  fallbackColorHex: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {actions.map((a) => {
          const resolved = resolveAction(a, templates);
          const chosen = chosenActionId === a.id;

          if (chosen) {
            // Chosen — clicking clears
            return (
              <form key={a.id} action={clearChoice}>
                <input type="hidden" name="playthrough_id" value={playthroughId} />
                <input type="hidden" name="inspection_letter_id" value={letterId} />
                <button
                  type="submit"
                  title={`Clear: ${resolved.name}`}
                  className="rounded-md opacity-100 ring-2 ring-offset-1 ring-offset-background"
                  style={{ ["--tw-ring-color" as string]: resolved.colorHex }}
                >
                  <ActionPill
                    name={resolved.name}
                    iconType={resolved.iconType}
                    iconValue={resolved.iconValue}
                    colorHex={resolved.colorHex}
                  />
                </button>
              </form>
            );
          }

          // Not chosen — clicking selects
          return (
            <form key={a.id} action={chooseAction}>
              <input type="hidden" name="playthrough_id" value={playthroughId} />
              <input type="hidden" name="inspection_letter_id" value={letterId} />
              <input type="hidden" name="chosen_action_id" value={a.id} />
              <button
                type="submit"
                title={resolved.name}
                className="rounded-md opacity-40 transition-opacity hover:opacity-75"
              >
                <ActionPill
                  name={resolved.name}
                  iconType={resolved.iconType}
                  iconValue={resolved.iconValue}
                  colorHex={resolved.colorHex}
                />
              </button>
            </form>
          );
        })}

        {actions.length === 0 ? (
          <span className="text-xs italic text-muted-foreground/50">
            No actions on this letter.
          </span>
        ) : null}
      </div>

      {/* Fallback hint — shown when the letter has a fallback configured */}
      {fallbackActionName ? (
        <p className="text-[10px] italic text-muted-foreground/50">
          Fallback:{" "}
          {fallbackColorHex ? (
            <span
              className="rounded px-1 not-italic"
              style={{
                backgroundColor: `${fallbackColorHex}33`,
                color: fallbackColorHex,
              }}
            >
              {fallbackActionName}
            </span>
          ) : (
            fallbackActionName
          )}{" "}
          — applied automatically if no action is chosen before advancing.
        </p>
      ) : null}
    </div>
  );
}

// ── Letter card ───────────────────────────────────────────────────────────────

function LetterCard({
  letter,
  storyline,
  actions,
  templates,
  chosenActionId,
  playthroughId,
}: {
  letter: DeliveredLetterWithFallback;
  storyline: Storyline | undefined;
  actions: ActionRow[];
  templates: ActionTemplate[];
  chosenActionId: string | undefined;
  playthroughId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="flex flex-col rounded-md border border-border bg-card overflow-hidden">
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
        aria-expanded={expanded}
      >
        <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <InspectionLetterPill
          storyline={storyline}
          contentId={letter.content_id}
          className="shrink-0"
        />
        {/* Addresses */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-foreground/80">
            {letter.summary ? (
              <span className="truncate text-muted-foreground italic">
                {letter.summary}
              </span>
            ) : null}
          </div>
        </div>
        {/* Chosen action badge (collapsed view) */}
        {!expanded && chosenActionId ? (
          <span className="shrink-0">
            {(() => {
              const act = actions.find((a) => a.id === chosenActionId);
              if (!act) return null;
              const resolved = resolveAction(act, templates);
              return (
                <ActionPill
                  name={resolved.name}
                  iconType={resolved.iconType}
                  iconValue={resolved.iconValue}
                  colorHex={resolved.colorHex}
                  iconOnly
                />
              );
            })()}
          </span>
        ) : null}
      </button>

      {/* Expanded body */}
      {expanded ? (
        <div className="flex flex-col gap-4 border-t border-border px-3 py-3">
          {/* Content */}
          {letter.content !== null ? (
            <RichTextReadonly
              value={letter.content}
              className="rounded-md bg-[var(--block-result-bg)] px-3 py-2 font-mono text-sm text-foreground"
              emptyFallback={
                <span className="italic text-muted-foreground/50">(no content)</span>
              }
            />
          ) : (
            <p className="text-xs italic text-muted-foreground/50">
              No letter content.
            </p>
          )}

          {/* Action chooser */}
          <ActionChooser
            playthroughId={playthroughId}
            letterId={letter.id}
            actions={actions}
            templates={templates}
            chosenActionId={chosenActionId}
            fallbackActionName={letter.fallback_action_name}
            fallbackColorHex={letter.fallback_action_color_hex}
          />
        </div>
      ) : null}
    </div>
  );
}

// ── Phase wrapper ─────────────────────────────────────────────────────────────

/**
 * C3 — Inspection phase. Client component (needs click-to-expand state).
 * Accepts pre-resolved delivered letters + chosen actions from the page
 * server component.
 *
 * `phaseTimer` is a slot for Track A's <PhaseTimer>. Pass null until wired.
 */
export function PhaseInspection({
  day,
  playthroughId,
  letters,
  actionsByLetter,
  templates,
  chosenActionByLetter,
  storylines,
  phaseTimer = null,
}: {
  day: Day;
  playthroughId: string;
  /** Letters delivered on the current day, from playthrough_delivered_letters_view. */
  letters: DeliveredLetterWithFallback[];
  /** Map of inspection_letter_id → ActionRow[]. */
  actionsByLetter: Record<string, ActionRow[]>;
  templates: ActionTemplate[];
  /** Map of inspection_letter_id → chosen_action_id (from playthrough_action_choices). */
  chosenActionByLetter: Record<string, string>;
  storylines: Storyline[];
  /** Slot for Track A's <PhaseTimer>. Pass null until wired. */
  phaseTimer?: React.ReactNode;
}) {
  const storylinesById = new Map(storylines.map((s) => [s.id, s]));

  return (
    <div className="flex flex-col gap-6">
      {/* Phase header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Inspection — {day.identifier}
            {day.name ? ` — ${day.name}` : ""}
          </div>
          <p className="text-xs text-muted-foreground/70">
            {letters.length === 0
              ? "No letters delivered on this day."
              : `${letters.length} letter${letters.length === 1 ? "" : "s"} delivered. Click a letter to read and choose an action.`}
          </p>
        </div>
        {phaseTimer ?? null}
      </div>

      {/* Letter cards */}
      {letters.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          No letters are scheduled for delivery on {day.identifier}.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {letters.map((letter) => {
            const storyline = storylinesById.get(letter.storyline_id);
            const actions = actionsByLetter[letter.id] ?? [];
            const chosenActionId = chosenActionByLetter[letter.id];
            return (
              <LetterCard
                key={letter.id}
                letter={letter}
                storyline={storyline}
                actions={actions}
                templates={templates}
                chosenActionId={chosenActionId}
                playthroughId={playthroughId}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
