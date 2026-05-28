// C2 — Sorting phase content.
//
// Read-only render of the active sorting rules for the current day.
// Reuses `RulePill` (the diamond glyph) and `SlotPill` from the sorting rules
// UI. The ≤3 conditions cap was lifted by 0042_sorting_rules_revamp.sql —
// renders however many condition rows the rule has.
//
// Leaves a slot for <PhaseTimer> (Track A); wired later.

import {
  RULE_OPERATOR_LABELS,
  RULE_TARGET_LABELS,
} from "@/lib/db/enums";
import { RulePill } from "@/app/(authed)/sorting/rules/rule-pill";
import { SlotPill } from "@/app/(authed)/sorting/rules/slot-pill";
import type { Day, SortingRule, SortingRuleCondition } from "@/lib/db/types";

// ── Condition chip ────────────────────────────────────────────────────────────

function ConditionChip({ condition }: { condition: SortingRuleCondition }) {
  const targetLabel = RULE_TARGET_LABELS[condition.target] ?? condition.target;
  const operatorLabel = RULE_OPERATOR_LABELS[condition.operator] ?? condition.operator;
  const valueLabel = condition.reference_value ?? condition.reference_type;

  return (
    <span className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-mono text-xs text-foreground">
      <span className="text-muted-foreground">{targetLabel}</span>
      <span className="font-semibold">{operatorLabel}</span>
      <span className="text-foreground/80">{valueLabel}</span>
    </span>
  );
}

// ── Rule row ─────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  conditions,
}: {
  rule: SortingRule;
  conditions: SortingRuleCondition[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <RulePill letter={rule.letter} color={rule.color_hex} />
        <SlotPill
          slot={rule.destination_slot}
          reporting={rule.routes_to_reporting}
        />
        {rule.summary ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {rule.summary}
          </span>
        ) : null}
      </div>

      {/* Conditions */}
      {conditions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pl-1">
          {conditions.map((c) => (
            <ConditionChip key={c.id} condition={c} />
          ))}
        </div>
      ) : (
        <p className="pl-1 text-xs italic text-muted-foreground/50">
          No conditions — matches every letter.
        </p>
      )}

      {/* Storage location (if set) */}
      {rule.storage_location ? (
        <p className="pl-1 font-mono text-[11px] text-muted-foreground/70">
          Storage: {rule.storage_location}
        </p>
      ) : null}
    </div>
  );
}

// ── Phase wrapper ─────────────────────────────────────────────────────────────

/**
 * C2 — Sorting phase. Server-friendly (no "use client"). Renders active rules
 * for the current day in display order.
 *
 * A rule is "active" on a given day when:
 *   - `day_implemented_id` is null OR its day number ≤ current day's number.
 *   - `day_cancelled_id` is null OR its day number > current day's number.
 *
 * The page server component is responsible for passing only the active rules;
 * this component renders whatever it receives.
 *
 * `phaseTimer` is a slot for Track A's <PhaseTimer> component; pass null until
 * Track A lands.
 */
export function PhaseSorting({
  day,
  rules,
  conditionsByRule,
  phaseTimer = null,
}: {
  day: Day;
  /** Active sorting rules for this day, in sort_order. */
  rules: SortingRule[];
  /** Map of rule_id → ordered conditions. */
  conditionsByRule: Record<string, SortingRuleCondition[]>;
  /** Slot for Track A's <PhaseTimer>. Pass null until wired. */
  phaseTimer?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Phase header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Sorting — {day.identifier}
            {day.name ? ` — ${day.name}` : ""}
          </div>
          <p className="text-xs text-muted-foreground/70">
            Sort each letter according to the rules below. Most recently
            implemented rule takes precedence on conflict.
          </p>
        </div>
        {/* Timer slot (Track A) */}
        {phaseTimer ?? null}
      </div>

      {/* Rules list */}
      {rules.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          No active sorting rules for {day.identifier}.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              conditions={conditionsByRule[rule.id] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
