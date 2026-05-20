"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";
import { MUTED_ADD_BTN, Spinner } from "@/components/panel";
import type { PostgresChange } from "@/lib/realtime/channel";
import type { PresenceProfile } from "@/lib/realtime/presence";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import type {
  City,
  Day,
  Nation,
  SortingRule,
  SortingRuleCondition,
} from "@/lib/db/types";
import { createRule } from "./actions";
import { RulePill } from "./rule-pill";
import { RulePanel } from "./rule-panel";

const POSTGRES_TABLES = ["sorting_rules", "sorting_rule_conditions"];

// ─── Public component: wraps inner in WorkspacePresenceProvider ──────────────

export function RulesList({
  rules,
  conditionsByRule,
  days,
  nations,
  cities,
  initialSelectedRuleId,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  rules: SortingRule[];
  conditionsByRule: Record<string, SortingRuleCondition[]>;
  days: Day[];
  nations: Nation[];
  cities: City[];
  initialSelectedRuleId: string | null;
  currentUserId?: string;
  currentEmail?: string;
  currentProfile?: PresenceProfile | null;
}) {
  return (
    <WorkspacePresenceProvider
      channelName="sorting-rules"
      userId={currentUserId}
      email={currentEmail}
      profile={currentProfile}
      postgresTables={POSTGRES_TABLES}
    >
      <RulesWorkspace
        rules={rules}
        conditionsByRule={conditionsByRule}
        days={days}
        nations={nations}
        cities={cities}
        initialSelectedRuleId={initialSelectedRuleId}
        currentEmail={currentEmail}
      />
    </WorkspacePresenceProvider>
  );
}

// ─── Two-pane workspace: rules list (left) + inspection panel (right) ────────

function RulesWorkspace({
  rules: rulesProp,
  conditionsByRule: conditionsByRuleProp,
  days,
  nations,
  cities,
  initialSelectedRuleId,
  currentEmail,
}: {
  rules: SortingRule[];
  conditionsByRule: Record<string, SortingRuleCondition[]>;
  days: Day[];
  nations: Nation[];
  cities: City[];
  initialSelectedRuleId: string | null;
  currentEmail?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { onPostgresChanges } = usePresenceContext();
  const { toast, toaster } = useToast();

  // Mirror rules + conditions so postgres_changes fans out without reload.
  const [rules, setRules] = useState(rulesProp);
  const [prevRulesProp, setPrevRulesProp] = useState(rulesProp);
  if (rulesProp !== prevRulesProp) {
    setPrevRulesProp(rulesProp);
    setRules(rulesProp);
  }

  const [conditionsByRule, setConditionsByRule] = useState(conditionsByRuleProp);
  const [prevCondsByRule, setPrevCondsByRule] = useState(conditionsByRuleProp);
  if (conditionsByRuleProp !== prevCondsByRule) {
    setPrevCondsByRule(conditionsByRuleProp);
    setConditionsByRule(conditionsByRuleProp);
  }

  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(
    initialSelectedRuleId
  );
  const selectedRule = rules.find((r) => r.id === selectedRuleId) ?? null;

  // Keep ?rule=<letter> in sync with the selection (and with letter renames).
  useEffect(() => {
    const rule = rules.find((r) => r.id === selectedRuleId);
    const target = rule
      ? `${pathname}?rule=${encodeURIComponent(rule.letter)}`
      : pathname;
    router.replace(target, { scroll: false });
  }, [selectedRuleId, rules, pathname, router]);

  // Debounced router.refresh for INSERT events (view-derived columns need RSC).
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      startTransition(() => router.refresh());
    }, 100);
  }, [router]);

  // postgres_changes subscription
  useEffect(() => {
    return onPostgresChanges((change: PostgresChange) => {
      const { table, eventType } = change;

      if (table === "sorting_rules") {
        if (eventType === "UPDATE") {
          const newRow = change.new as Record<string, unknown>;
          const id = newRow.id as string | undefined;
          if (!id) return;
          setRules((prev) =>
            prev.map((r) =>
              r.id === id ? ({ ...r, ...newRow } as unknown as SortingRule) : r
            )
          );
          return;
        }
        if (eventType === "DELETE") {
          const oldRow = change.old as Record<string, unknown> | undefined;
          const id = oldRow?.id as string | undefined;
          if (!id) return;
          setRules((prev) => prev.filter((r) => r.id !== id));
          setConditionsByRule((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setSelectedRuleId((cur) => (cur === id ? null : cur));
          const by = (oldRow?.updated_by as string | undefined) ?? "Someone";
          // Suppress the toast when WE were the one who deleted — the kebab
          // confirm already conveyed intent and the panel closes on its own.
          // Peers still get the destructive heads-up.
          if (by !== currentEmail) {
            toast({
              intent: "destructive",
              message: `${by} deleted a sorting rule`,
            });
          }
          return;
        }
        if (eventType === "INSERT") {
          scheduleRefresh();
          return;
        }
      }

      if (table === "sorting_rule_conditions") {
        if (eventType === "UPDATE") {
          const newRow = change.new as Record<string, unknown>;
          const id = newRow.id as string | undefined;
          const ruleId = newRow.rule_id as string | undefined;
          if (!id || !ruleId) return;
          setConditionsByRule((prev) => ({
            ...prev,
            [ruleId]: (prev[ruleId] ?? []).map((c) =>
              c.id === id
                ? ({ ...c, ...newRow } as unknown as SortingRuleCondition)
                : c
            ),
          }));
          return;
        }
        if (eventType === "INSERT" || eventType === "DELETE") {
          // Conditions are replaced as a set; trigger RSC refresh so the
          // mirror stays consistent with position ordering.
          scheduleRefresh();
          return;
        }
      }
    });
  }, [onPostgresChanges, toast, scheduleRefresh, currentEmail]);

  const [creating, startCreate] = useTransition();
  function handleCreate() {
    startCreate(async () => {
      const res = await createRule();
      setSelectedRuleId(res.id);
    });
  }

  return (
    <>
      {toaster}
      <div className="flex gap-3">
        {/* List pane — fixed width, doesn't reflow when the panel opens/closes */}
        <div className="flex w-80 shrink-0 flex-col gap-2">
          {rules.map((r) => (
            <RuleListRow
              key={r.id}
              rule={r}
              selected={r.id === selectedRuleId}
              onSelect={() => setSelectedRuleId(r.id)}
            />
          ))}
          {rules.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No rules yet.
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || rules.length >= 26}
            className={cn(MUTED_ADD_BTN, "mt-1 self-start")}
          >
            {creating ? <Spinner /> : <span aria-hidden>+</span>}
            Rule
          </button>
        </div>

        {/* Panel pane — blank until a rule is selected */}
        <div className="min-w-0 flex-1">
          {selectedRule ? (
            <RulePanel
              key={selectedRule.id}
              rule={selectedRule}
              conditions={conditionsByRule[selectedRule.id] ?? []}
              days={days}
              nations={nations}
              cities={cities}
              allRules={rules}
              onClose={() => setSelectedRuleId(null)}
              onSelectRule={(id) => setSelectedRuleId(id)}
              onConditionsError={(m) =>
                toast({ intent: "destructive", message: m })
              }
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

// ─── List row ────────────────────────────────────────────────────────────────

function RuleListRow({
  rule,
  selected,
  onSelect,
}: {
  rule: SortingRule;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors",
        selected ? "bg-accent/70 ring-1 ring-border" : "bg-accent/40 hover:bg-accent/60"
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <RulePill letter={rule.letter} />
        <span className="truncate text-sm">
          {rule.summary ?? <span className="text-muted-foreground">—</span>}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {rule.routes_to_reporting ? (
          <Badge variant="muted">reporting</Badge>
        ) : rule.destination_slot ? (
          <Badge variant="muted">slot {rule.destination_slot}</Badge>
        ) : null}
        <span aria-hidden>›</span>
      </span>
    </button>
  );
}
