"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { OverflowMenu, Spinner, type OverflowMenuItem } from "@/components/panel";
import { citizenDisplayName } from "@/lib/citizen-name";
import { displayCitizenId } from "@/lib/citizen-id";
import type { Citizen, Day, SortingLetterView } from "@/lib/db/types";
import { activeRules, dayNumbers, type RuleWithConditions } from "@/lib/rules/destination";
import {
  bulkApplyRuleToLetters,
  bulkDeleteSortingLetters,
  bulkPatchSortingLetters,
  bulkSetSortingLetterDay,
  renumberSortingLetters,
} from "./actions";

/** A bulk action that needs a value before it can run. */
type Prompt =
  | { kind: "day" }
  | { kind: "sender" }
  | { kind: "recipient" }
  | { kind: "storage" }
  | { kind: "notes" }
  | { kind: "rule" };

const PROMPT_TITLES: Record<Prompt["kind"], string> = {
  day: "Set delivery day",
  sender: "Set sender",
  recipient: "Set recipient",
  storage: "Set storage location",
  notes: "Set notes",
  rule: "Set sorting rule",
};

export function BulkBar({
  selected,
  days,
  citizens,
  rules,
  onDone,
  onClearSelection,
  onConfirm,
  onError,
  onMessage,
}: {
  selected: SortingLetterView[];
  days: Day[];
  citizens: Citizen[];
  rules: RuleWithConditions[];
  onDone: () => void;
  onClearSelection: () => void;
  onConfirm: (options: {
    title: string;
    message: string;
    confirmLabel: string;
    intent?: "destructive" | "default";
  }) => Promise<boolean>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [pending, startAction] = useTransition();

  const ids = selected.map((l) => l.id);
  const dayIds = new Set(selected.map((l) => l.day_id));
  const singleDay = dayIds.size === 1 ? [...dayIds][0] : null;

  function run(work: () => Promise<void>) {
    startAction(async () => {
      try {
        await work();
        onDone();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const items: OverflowMenuItem[] = [
    { label: "Set delivery day…", onClick: () => setPrompt({ kind: "day" }) },
    { label: "Set sender…", onClick: () => setPrompt({ kind: "sender" }) },
    { label: "Set recipient…", onClick: () => setPrompt({ kind: "recipient" }) },
    { label: "Set storage location…", onClick: () => setPrompt({ kind: "storage" }) },
    { label: "Set notes…", onClick: () => setPrompt({ kind: "notes" }) },
    {
      label: "Stamp: valid",
      onClick: () =>
        run(() => bulkPatchSortingLetters(ids, { kind: "stamp", value: true })),
    },
    {
      label: "Stamp: fake",
      onClick: () =>
        run(() => bulkPatchSortingLetters(ids, { kind: "stamp", value: false })),
    },
    {
      label: singleDay ? "Set sorting rule…" : "Set sorting rule (one day only)",
      onClick: () => setPrompt({ kind: "rule" }),
      disabled: !singleDay,
    },
    { divider: true },
    {
      label: "Clear storage",
      onClick: () =>
        run(() => bulkPatchSortingLetters(ids, { kind: "storage", value: null })),
    },
    {
      label: "Clear sender",
      onClick: () =>
        run(() => bulkPatchSortingLetters(ids, { kind: "sender", citizenId: null })),
    },
    {
      label: "Clear recipient",
      onClick: () =>
        run(() =>
          bulkPatchSortingLetters(ids, { kind: "recipient", citizenId: null })
        ),
    },
    {
      label: "Clear notes",
      onClick: () =>
        run(() => bulkPatchSortingLetters(ids, { kind: "notes", value: null })),
    },
    {
      label: "Clear all fields",
      onClick: async () => {
        const ok = await onConfirm({
          title: "Clear every field?",
          message: `Sender, recipient, storage and notes will be emptied on ${ids.length} letter${ids.length === 1 ? "" : "s"}. IDs and days are kept.`,
          confirmLabel: "Clear",
        });
        if (ok) run(() => bulkPatchSortingLetters(ids, { kind: "all" }));
      },
    },
    { divider: true },
    {
      label: singleDay ? "Renumber IDs on this day" : "Renumber IDs (one day only)",
      disabled: !singleDay,
      onClick: async () => {
        if (!singleDay) return;
        const ok = await onConfirm({
          title: "Renumber this day?",
          message:
            "Every letter on the day is renumbered from 0 upwards in its current order, closing any gaps. Letters outside the selection are renumbered too.",
          confirmLabel: "Renumber",
        });
        if (ok) run(() => renumberSortingLetters(singleDay));
      },
    },
    {
      label: "Delete letters",
      intent: "destructive",
      onClick: async () => {
        const ok = await onConfirm({
          title: `Delete ${ids.length} sorting letter${ids.length === 1 ? "" : "s"}?`,
          message: "This cannot be undone.",
          confirmLabel: "Delete",
          intent: "destructive",
        });
        if (ok) run(() => bulkDeleteSortingLetters(ids));
      },
    },
  ];

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border bg-accent/20 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {ids.length} selected
        </span>
        {pending ? <Spinner /> : null}
        <button
          type="button"
          onClick={onClearSelection}
          className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Clear
        </button>
        <span className="ml-auto flex items-center gap-1">
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Bulk actions
          </span>
          <OverflowMenu items={items} />
        </span>
      </div>

      {prompt ? (
        <BulkPrompt
          prompt={prompt}
          days={days}
          citizens={citizens}
          rules={rules}
          singleDay={singleDay}
          onClose={() => setPrompt(null)}
          onSubmit={(value) => {
            setPrompt(null);
            switch (prompt.kind) {
              case "day":
                return run(() => bulkSetSortingLetterDay(ids, value));
              case "sender":
                return run(() =>
                  bulkPatchSortingLetters(ids, {
                    kind: "sender",
                    citizenId: value || null,
                  })
                );
              case "recipient":
                return run(() =>
                  bulkPatchSortingLetters(ids, {
                    kind: "recipient",
                    citizenId: value || null,
                  })
                );
              case "storage":
                return run(() =>
                  bulkPatchSortingLetters(ids, {
                    kind: "storage",
                    value: value.trim() || null,
                  })
                );
              case "notes":
                return run(() =>
                  bulkPatchSortingLetters(ids, {
                    kind: "notes",
                    value: value.trim() || null,
                  })
                );
              case "rule":
                return run(async () => {
                  const result = await bulkApplyRuleToLetters(ids, value);
                  if (result.updated < result.requested) {
                    onError(
                      `Rewrote ${result.updated} of ${result.requested}. ${result.reason ?? ""}`.trim()
                    );
                  } else {
                    onMessage(
                      `Rewrote ${result.updated} letter${result.updated === 1 ? "" : "s"} to sort by that rule.`
                    );
                  }
                });
            }
          }}
        />
      ) : null}
    </>
  );
}

// ─── Value prompt ────────────────────────────────────────────────────────────

function BulkPrompt({
  prompt,
  days,
  citizens,
  rules,
  singleDay,
  onClose,
  onSubmit,
}: {
  prompt: Prompt;
  days: Day[];
  citizens: Citizen[];
  rules: RuleWithConditions[];
  singleDay: string | null;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const dayNumberById = useMemo(() => dayNumbers(days), [days]);
  const day = singleDay ? days.find((d) => d.id === singleDay) : null;
  const availableRules = useMemo(() => {
    if (!day) return [];
    return activeRules(rules, dayNumberById, day.number).map((r) => r.rule);
  }, [rules, dayNumberById, day]);

  const sortedCitizens = useMemo(
    () =>
      [...citizens].sort((a, b) =>
        citizenDisplayName(a).localeCompare(citizenDisplayName(b))
      ),
    [citizens]
  );

  const [value, setValue] = useState(() => {
    if (prompt.kind === "day") return days[0]?.id ?? "";
    if (prompt.kind === "rule") return availableRules[0]?.id ?? "";
    return "";
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={PROMPT_TITLES[prompt.kind]}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-md border border-border bg-card p-5 shadow-xl"
      >
        <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {PROMPT_TITLES[prompt.kind]}
        </h3>

        <div className="mt-4 flex flex-col gap-1">
          {prompt.kind === "day" ? (
            <>
              <Label>Delivery day</Label>
              <Select value={value} onChange={(e) => setValue(e.target.value)}>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.identifier}
                    {d.name ? ` — ${d.name}` : ""}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                A letter keeps its ID unless that ID is already taken on the new
                day, in which case it gets the lowest free one.
              </p>
            </>
          ) : null}

          {prompt.kind === "sender" || prompt.kind === "recipient" ? (
            <>
              <Label>Citizen</Label>
              <Select value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">— clear this side —</option>
                {sortedCitizens.map((c) => (
                  <option key={c.id} value={c.id}>
                    {citizenDisplayName(c) || "(unnamed)"}
                    {c.citizen_id ? ` ${displayCitizenId(c.citizen_id)}` : ""}
                  </option>
                ))}
              </Select>
            </>
          ) : null}

          {prompt.kind === "storage" ? (
            <>
              <Label>Storage location</Label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Bin 4 / Blue Bin"
                className="font-mono"
              />
            </>
          ) : null}

          {prompt.kind === "notes" ? (
            <>
              <Label>Notes</Label>
              <Input value={value} onChange={(e) => setValue(e.target.value)} />
            </>
          ) : null}

          {prompt.kind === "rule" ? (
            <>
              <Label>Should sort by</Label>
              <Select
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={availableRules.length === 0}
              >
                {availableRules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.letter}
                    {r.summary ? ` — ${r.summary}` : ""}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-warning">
                This rewrites the sender and recipient on every selected letter —
                that is the only way to change where a letter sorts. Storage,
                notes and IDs are left alone.
              </p>
              {availableRules.length === 0 ? (
                <p className="text-xs text-warning">
                  No sorting rule is active on that day.
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onSubmit(value)}
            disabled={
              (prompt.kind === "day" || prompt.kind === "rule") && !value
            }
          >
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
