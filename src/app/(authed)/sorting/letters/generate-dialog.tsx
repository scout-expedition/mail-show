"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/panel";
import type { Day } from "@/lib/db/types";
import { activeRules, dayNumbers, type RuleWithConditions } from "@/lib/rules/destination";
import { RulePill } from "../rules/rule-pill";
import { SlotPill } from "../rules/slot-pill";
import { generateSortingLetters, type GenerationResult } from "./actions";

/**
 * Fill a day with letters, so many per rule. Every rule in force on the chosen
 * day gets its own count — authoring a day's sorting load usually means "three
 * that go to slot 1, two to slot 4", not one rule at a time.
 */
export function GenerateDialog({
  days,
  rules,
  defaultDayId,
  onClose,
  onDone,
}: {
  days: Day[];
  rules: RuleWithConditions[];
  defaultDayId: string;
  onClose: () => void;
  onDone: (result: GenerationResult) => void;
}) {
  const [dayId, setDayId] = useState(defaultDayId || days[0]?.id || "");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [pending, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dayNumberById = useMemo(() => dayNumbers(days), [days]);
  const day = days.find((d) => d.id === dayId) ?? null;

  const available = useMemo(() => {
    if (!day) return [];
    return activeRules(rules, dayNumberById, day.number).map((r) => r.rule);
  }, [rules, dayNumberById, day]);

  const total = available.reduce(
    (sum, rule) => sum + (Number(counts[rule.id]) || 0),
    0
  );

  function handleGenerate() {
    setError(null);
    startGenerate(async () => {
      try {
        const result = await generateSortingLetters({
          dayId,
          requests: available.map((rule) => ({
            ruleId: rule.id,
            count: Number(counts[rule.id]) || 0,
          })),
        });
        onDone(result);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Generate sorting letters"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-md border border-border bg-card p-5 shadow-xl"
      >
        <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Generate sorting letters
        </h3>

        <div className="mt-4 flex flex-col gap-1">
          <Label>Show day</Label>
          <Select value={dayId} onChange={(e) => setDayId(e.target.value)}>
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.identifier}
                {d.name ? ` — ${d.name}` : ""}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <Label>How many per rule</Label>
          {available.length === 0 ? (
            <p className="mt-2 text-xs text-warning">
              No sorting rule is in force on that day. A rule only applies once
              it has an implemented day.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {available.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
                >
                  <RulePill letter={rule.letter} color={rule.color_hex} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {rule.summary ?? (
                      <span className="text-muted-foreground">(no summary)</span>
                    )}
                  </span>
                  <SlotPill
                    slot={rule.destination_slot}
                    reporting={rule.routes_to_reporting}
                  />
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={counts[rule.id] ?? ""}
                    placeholder="0"
                    onChange={(e) =>
                      setCounts((prev) => ({ ...prev, [rule.id]: e.target.value }))
                    }
                    aria-label={`How many letters for rule ${rule.letter}`}
                    className="h-8 w-16 font-mono"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          Senders and recipients are drawn from the citizen directory so each
          letter sorts to its rule today. A rule added later may re-route it.
        </p>

        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {total} letter{total === 1 ? "" : "s"}
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleGenerate}
            disabled={pending || total === 0 || !dayId}
          >
            {pending ? <Spinner /> : null}
            Generate
          </Button>
        </div>
      </div>
    </div>
  );
}
