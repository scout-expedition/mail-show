"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConditionDescription } from "@/components/condition-description";
import {
  ConditionBuilderInline,
  type BuilderCondition,
} from "@/components/condition-builder";
import type {
  Day,
  SortingRule,
  SortingRuleCondition,
} from "@/lib/db/types";
import type { RuleMatchMode } from "@/lib/db/enums";
import { deleteRule, duplicateRule, saveRuleAll } from "./actions";

export function RulesList({
  rules,
  conditionsByRule,
  days,
}: {
  rules: SortingRule[];
  conditionsByRule: Record<string, SortingRuleCondition[]>;
  days: Day[];
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const allOpen = rules.length > 0 && openIds.size === rules.length;

  function toggle(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allOpen) setOpenIds(new Set());
    else setOpenIds(new Set(rules.map((r) => r.id)));
  }

  return (
    <div className="flex flex-col gap-2 font-mono">
      {rules.length > 0 ? (
        <div className="mb-1 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={toggleAll}>
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>
      ) : null}

      {rules.map((r) => (
        <RuleRow
          key={r.id}
          rule={r}
          conditions={conditionsByRule[r.id] ?? []}
          days={days}
          open={openIds.has(r.id)}
          onToggle={() => toggle(r.id)}
        />
      ))}
      {rules.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No rules yet.
        </p>
      ) : null}
    </div>
  );
}

function toBuilderConditions(
  conditions: SortingRuleCondition[]
): BuilderCondition[] {
  return conditions.map((c) => ({
    target: c.target,
    target_slice: c.target_slice,
    operator: c.operator,
    reference_type: c.reference_type,
    reference_value: c.reference_value,
  }));
}

function RuleRow({
  rule,
  conditions,
  days,
  open,
  onToggle,
}: {
  rule: SortingRule;
  conditions: SortingRuleCondition[];
  days: Day[];
  open: boolean;
  onToggle: () => void;
}) {
  const [duplicating, startDuplicate] = useTransition();
  const [saving, startSave] = useTransition();

  // Editable local state — mirrors current server rule when opened fresh.
  const [letter, setLetter] = useState(rule.letter);
  const [slot, setSlot] = useState<number | null>(rule.destination_slot);
  const [dayId, setDayId] = useState<string | null>(rule.day_implemented_id);
  const [storage, setStorage] = useState<string | null>(rule.storage_location);
  const [summary, setSummary] = useState<string | null>(rule.summary);
  const [matchMode, setMatchMode] = useState<RuleMatchMode>(rule.match_mode);
  const [builderConds, setBuilderConds] = useState<BuilderCondition[]>(() =>
    toBuilderConditions(conditions)
  );
  const [dirty, setDirty] = useState(false);

  // When the row re-opens with new server data, refresh if user hasn't edited.
  const serverKey = useMemo(
    () =>
      JSON.stringify([
        rule.letter,
        rule.destination_slot,
        rule.day_implemented_id,
        rule.storage_location,
        rule.summary,
        rule.match_mode,
        conditions.map((c) => [
          c.target,
          c.target_slice,
          c.operator,
          c.reference_type,
          c.reference_value,
        ]),
      ]),
    [rule, conditions]
  );
  const [lastKey, setLastKey] = useState(serverKey);
  if (!dirty && lastKey !== serverKey) {
    setLetter(rule.letter);
    setSlot(rule.destination_slot);
    setDayId(rule.day_implemented_id);
    setStorage(rule.storage_location);
    setSummary(rule.summary);
    setMatchMode(rule.match_mode);
    setBuilderConds(toBuilderConditions(conditions));
    setLastKey(serverKey);
  }

  function handleDuplicate(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    const fd = new FormData();
    fd.append("id", rule.id);
    startDuplicate(async () => {
      await duplicateRule(fd);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete rule RR-${rule.letter}? This cannot be undone.`))
      return;
    const fd = new FormData();
    fd.append("id", rule.id);
    startSave(async () => {
      await deleteRule(fd);
    });
  }

  function handleSave() {
    startSave(async () => {
      await saveRuleAll({
        id: rule.id,
        letter: (letter || "").toUpperCase().slice(0, 1),
        destination_slot: slot,
        day_implemented_id: dayId,
        storage_location: storage,
        summary,
        match_mode: matchMode,
        conditions: builderConds,
      });
      setDirty(false);
    });
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-accent/40">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left hover:bg-accent/60"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span
            className="relative flex h-6 w-6 shrink-0 items-center justify-center font-mono text-xs"
            aria-label={`Rule ${rule.letter}`}
          >
            <svg
              viewBox="0 0 24 24"
              className="absolute inset-0 h-full w-full text-muted-foreground"
              fill="currentColor"
              aria-hidden
            >
              <polygon points="12,2 22.46,9.6 18.47,21.9 5.53,21.9 1.54,9.6" />
            </svg>
            <span className="relative text-background">{rule.letter}</span>
          </span>
          <span className="text-sm">
            {rule.summary ?? <span className="text-muted-foreground">—</span>}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {rule.destination_slot ? (
            <Badge variant="muted">slot {rule.destination_slot}</Badge>
          ) : null}
          <span
            role="button"
            tabIndex={0}
            onClick={handleDuplicate}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleDuplicate(e);
            }}
            aria-label="Duplicate rule"
            title="Duplicate"
            aria-disabled={duplicating}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
          >
            <DuplicateIcon />
          </span>
          <span aria-hidden className={open ? "rotate-90" : ""}>
            ›
          </span>
        </div>
      </button>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-border bg-card px-3 py-3">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-1 flex flex-col gap-1">
              <Label>Letter</Label>
              <Input
                value={letter}
                onChange={(e) => {
                  setLetter(
                    e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1)
                  );
                  setDirty(true);
                }}
                maxLength={1}
                className="h-8 text-center uppercase"
              />
            </div>
            <div className="col-span-1 flex flex-col gap-1">
              <Label>Slot</Label>
              <Input
                type="number"
                min={1}
                max={8}
                value={slot ?? ""}
                onChange={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  setSlot(v);
                  setDirty(true);
                }}
                className="h-8"
              />
            </div>
            <div className="col-span-4 flex flex-col gap-1">
              <Label>Day implemented</Label>
              <Select
                value={dayId ?? ""}
                onChange={(e) => {
                  setDayId(e.target.value || null);
                  setDirty(true);
                }}
                className="h-8"
              >
                <option value="">—</option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.identifier}
                    {d.name ? ` — ${d.name}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-6 flex flex-col gap-1">
              <Label>Storage location</Label>
              <Input
                value={storage ?? ""}
                onChange={(e) => {
                  setStorage(e.target.value || null);
                  setDirty(true);
                }}
                placeholder="e.g. Yellow Bin"
                className="h-8"
              />
            </div>
            <div className="col-span-12 flex flex-col gap-1">
              <Label>Summary</Label>
              <Textarea
                value={summary ?? ""}
                onChange={(e) => {
                  setSummary(e.target.value || null);
                  setDirty(true);
                }}
                rows={2}
              />
            </div>
          </div>

          <ConditionBuilderInline
            conditions={builderConds}
            matchMode={matchMode}
            onChange={(next, mode) => {
              setBuilderConds(next);
              if (mode) setMatchMode(mode);
              setDirty(true);
            }}
          />

          {/* Read-only description */}
          {builderConds.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-md border border-dashed border-border p-2">
              {conditions.map((c, i) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <ConditionDescription c={c} />
                  {i < conditions.length - 1 ? (
                    <Badge className="border-transparent bg-transparent text-muted-foreground lowercase">
                      {rule.match_mode === "all" ? "and" : "and/or"}
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={handleDelete}
              disabled={saving}
            >
              Delete rule
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || !dirty}
              variant={dirty ? "default" : "secondary"}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DuplicateIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
