"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/panel";
import type { Day, SortingRule } from "@/lib/db/types";
import { activeRules, dayNumbers, type RuleWithConditions } from "@/lib/rules/destination";
import { generateSortingLetters } from "./actions";

/**
 * Fill a day with letters that sort to a chosen rule. Only rules actually in
 * force on the selected day are offered — generating for a rule that isn't
 * active yet would produce letters that sort somewhere else entirely.
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
  onDone: (result: { created: number; requested: number; reason?: string }) => void;
}) {
  const [dayId, setDayId] = useState(defaultDayId || days[0]?.id || "");
  const [count, setCount] = useState("5");
  const [pending, startGenerate] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dayNumberById = useMemo(() => dayNumbers(days), [days]);
  const day = days.find((d) => d.id === dayId) ?? null;

  const available: SortingRule[] = useMemo(() => {
    if (!day) return [];
    return activeRules(rules, dayNumberById, day.number).map((r) => r.rule);
  }, [rules, dayNumberById, day]);

  const [ruleId, setRuleId] = useState("");
  const effectiveRuleId =
    ruleId && available.some((r) => r.id === ruleId) ? ruleId : (available[0]?.id ?? "");

  function handleGenerate() {
    setError(null);
    startGenerate(async () => {
      try {
        const result = await generateSortingLetters({
          dayId,
          ruleId: effectiveRuleId,
          count: Number(count) || 0,
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
        className="w-full max-w-md rounded-md border border-border bg-card p-5 shadow-xl"
      >
        <h3 className="font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Generate sorting letters
        </h3>

        <div className="mt-4 grid grid-cols-6 gap-3">
          <div className="col-span-4 flex flex-col gap-1">
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

          <div className="col-span-2 flex flex-col gap-1">
            <Label>How many</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="col-span-6 flex flex-col gap-1">
            <Label>Should sort by</Label>
            <Select
              value={effectiveRuleId}
              onChange={(e) => setRuleId(e.target.value)}
              disabled={available.length === 0}
            >
              {available.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.letter}
                  {r.summary ? ` — ${r.summary}` : ""}
                </option>
              ))}
            </Select>
            {available.length === 0 ? (
              <p className="text-xs text-warning">
                No sorting rule is active on that day.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Senders and recipients are drawn from the citizen directory so the
                letter sorts here today. A rule added later may re-route it.
              </p>
            )}
          </div>
        </div>

        {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleGenerate}
            disabled={pending || !effectiveRuleId || !dayId}
          >
            {pending ? <Spinner /> : null}
            Generate
          </Button>
        </div>
      </div>
    </div>
  );
}
