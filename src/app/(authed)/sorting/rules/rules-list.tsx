"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { ArrowDownAZ, GripVertical, Plus, RefreshCw } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";
import { OverflowMenu, PanelHeader, Spinner } from "@/components/panel";
import {
  useRenumberDialog,
  type RenumberItem,
} from "@/components/renumber-dialog";
import type { PostgresChange } from "@/lib/realtime/channel";
import type { PresenceProfile } from "@/lib/realtime/presence";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import type {
  City,
  Day,
  EndingVariable,
  Nation,
  SortingRule,
  SortingRuleCondition,
  Storyline,
} from "@/lib/db/types";
import {
  applyRuleLetters,
  createRule,
  renumberRuleLetters,
  reorderRules,
  sortRulesByLetter,
} from "./actions";
import { RulePill } from "./rule-pill";
import { RulePanel } from "./rule-panel";
import { SlotPill } from "./slot-pill";

const POSTGRES_TABLES = ["sorting_rules", "sorting_rule_conditions"];

// ─── Public component: wraps inner in WorkspacePresenceProvider ──────────────

export function RulesList({
  rules,
  conditionsByRule,
  days,
  nations,
  cities,
  storylines,
  endingVariables,
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
  storylines: Storyline[];
  endingVariables: EndingVariable[];
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
        storylines={storylines}
        endingVariables={endingVariables}
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
  storylines,
  endingVariables,
  initialSelectedRuleId,
  currentEmail,
}: {
  rules: SortingRule[];
  conditionsByRule: Record<string, SortingRuleCondition[]>;
  days: Day[];
  nations: Nation[];
  cities: City[];
  storylines: Storyline[];
  endingVariables: EndingVariable[];
  initialSelectedRuleId: string | null;
  currentEmail?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { onPostgresChanges } = usePresenceContext();
  const { toast, toaster } = useToast();
  const { openRenumber, dialog: renumberDialog } = useRenumberDialog();

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

  // Optimistic ordering override after a drag-drop. Sits in front of the
  // server's `sort_order` until every rule's persisted value catches up —
  // this keeps the list from flickering back to old positions during the
  // round-trip. Cleared when (a) every rule's actual sort_order matches the
  // optimistic position, or (b) the rule set changes (an insert or delete
  // means the snapshot is stale — fall back to server state immediately).
  const [optimisticOrder, setOptimisticOrder] =
    useState<Map<string, number> | null>(null);
  useEffect(() => {
    if (!optimisticOrder) return;
    const ruleIds = new Set(rules.map((r) => r.id));
    const sameRuleSet =
      ruleIds.size === optimisticOrder.size &&
      rules.every((r) => optimisticOrder.has(r.id));
    if (!sameRuleSet) {
      setOptimisticOrder(null);
      return;
    }
    const allMatch = rules.every(
      (r) => optimisticOrder.get(r.id) === (r.sort_order ?? 0)
    );
    if (allMatch) setOptimisticOrder(null);
  }, [rules, optimisticOrder]);

  const sortedRules = useMemo(
    () =>
      [...rules].sort((a, b) => {
        const aOrder = optimisticOrder?.get(a.id) ?? a.sort_order ?? 0;
        const bOrder = optimisticOrder?.get(b.id) ?? b.sort_order ?? 0;
        return aOrder - bOrder || a.letter.localeCompare(b.letter);
      }),
    [rules, optimisticOrder]
  );

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

  // ── Drag reorder ─────────────────────────────────────────────────────────
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const handleDrop = useCallback(
    (targetId: string) => {
      if (!dragId || dragId === targetId) {
        setDragId(null);
        setDragOverId(null);
        return;
      }
      const ids = sortedRules.map((r) => r.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return;
      const next = ids.slice();
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      // Hold the new ordering on the client until every rule's persisted
      // `sort_order` matches — see `optimisticOrder` above.
      const orderMap = new Map(next.map((id, i) => [id, i]));
      setOptimisticOrder(orderMap);
      setDragId(null);
      setDragOverId(null);
      void reorderRules(next).catch((err) => {
        setOptimisticOrder(null);
        toast({
          intent: "destructive",
          message: `Couldn't save the new order: ${err.message}`,
        });
        scheduleRefresh();
      });
    },
    [dragId, sortedRules, scheduleRefresh, toast]
  );

  // ── Kebab actions for the list pane ──────────────────────────────────────
  const [actionPending, startAction] = useTransition();
  function handleSortById() {
    startAction(async () => {
      try {
        await sortRulesByLetter();
      } catch (err) {
        toast({
          intent: "destructive",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
  function handleRenumberRules() {
    startAction(async () => {
      try {
        await renumberRuleLetters();
      } catch (err) {
        toast({
          intent: "destructive",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  // ── Per-rule Edit ID popup ──────────────────────────────────────────────
  async function handleEditRuleId(targetRuleId: string) {
    const target = sortedRules.find((r) => r.id === targetRuleId);
    if (!target) return;
    const items: RenumberItem[] = sortedRules.map((r) => ({
      id: r.id,
      numberToken: r.letter,
      name: r.summary ?? "(no summary)",
    }));
    const result = await openRenumber({
      kind: "sortingRule",
      items,
      targetId: target.id,
      prefix: "RR-",
    });
    if (!result) return;
    // `newNumberToken` from the sortingRule codec is already a letter (A-Z).
    const assignments = result.edits.map((e) => ({
      id: e.id,
      letter: e.newNumberToken.toUpperCase(),
    }));
    try {
      await applyRuleLetters(assignments);
    } catch (err) {
      toast({
        intent: "destructive",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const listMenuItems = [
    {
      label: "Sort by ID",
      icon: <ArrowDownAZ size={12} aria-hidden />,
      onClick: handleSortById,
      disabled: actionPending || rules.length < 2,
    },
    {
      label: "Renumber Rules",
      icon: <RefreshCw size={12} aria-hidden />,
      onClick: handleRenumberRules,
      disabled: actionPending || rules.length < 2,
    },
  ];

  return (
    <>
      {toaster}
      {renumberDialog}
      <div className="flex gap-3">
        <aside className="flex w-80 shrink-0 flex-col gap-2">
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <PanelHeader
              title="Rules"
              menu={
                <span className="flex items-center gap-0.5">
                  {actionPending ? (
                    <span
                      className="inline-flex items-center gap-1 px-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
                      title="Sorting…"
                    >
                      <Spinner />
                      <span>Sorting</span>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating || rules.length >= 26}
                    aria-label="Add rule"
                    title="Add rule"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creating ? <Spinner /> : <Plus size={14} aria-hidden />}
                  </button>
                  <OverflowMenu items={listMenuItems} />
                </span>
              }
            />
            {rules.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                None yet.
              </p>
            ) : (
              <ul>
                {sortedRules.map((r) => (
                  <RuleListRow
                    key={r.id}
                    rule={r}
                    selected={r.id === selectedRuleId}
                    onSelect={() => setSelectedRuleId(r.id)}
                    onDragStart={() => setDragId(r.id)}
                    onDragOver={() => setDragOverId(r.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setDragOverId(null);
                    }}
                    onDrop={() => handleDrop(r.id)}
                    dragOver={dragOverId === r.id && dragId !== r.id}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {selectedRule ? (
            <RulePanel
              key={selectedRule.id}
              rule={selectedRule}
              conditions={conditionsByRule[selectedRule.id] ?? []}
              days={days}
              nations={nations}
              cities={cities}
              storylines={storylines}
              endingVariables={endingVariables}
              allRules={rules}
              onClose={() => setSelectedRuleId(null)}
              onSelectRule={(id) => setSelectedRuleId(id)}
              onEditId={() => handleEditRuleId(selectedRule.id)}
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
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  dragOver,
}: {
  rule: SortingRule;
  selected: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  dragOver: boolean;
}) {
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={cn(
        "group",
        dragOver && "border-t-2 border-primary"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        className={cn(
          "flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-sm last:border-b-0 hover:bg-accent/40",
          selected && "bg-accent/60 text-accent-foreground"
        )}
      >
        <GripVertical
          size={12}
          aria-hidden
          className="cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
        />
        <RulePill letter={rule.letter} color={rule.color_hex} />
        <span className="min-w-0 flex-1 truncate">
          {rule.summary ?? <span className="text-muted-foreground">—</span>}
        </span>
        <SlotPill
          slot={rule.destination_slot}
          reporting={rule.routes_to_reporting}
        />
      </button>
    </li>
  );
}
