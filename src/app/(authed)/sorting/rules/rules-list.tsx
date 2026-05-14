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
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConditionDescription } from "@/components/condition-description";
import { useConfirm } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import {
  ConditionBuilderInline,
  type BuilderCondition,
} from "@/components/condition-builder";
import { AvatarStack } from "@/lib/realtime/avatar-stack";
import { FieldHighlight } from "@/lib/realtime/field-highlight";
import type { PostgresChange } from "@/lib/realtime/channel";
import type { PresenceFocus, PresenceProfile } from "@/lib/realtime/presence";
import {
  WorkspacePresenceProvider,
  usePresenceContext,
} from "@/lib/realtime/presence-context";
import { useInstantField } from "@/lib/realtime/use-instant-field";
import type {
  Day,
  SortingRule,
  SortingRuleCondition,
} from "@/lib/db/types";
import type { RuleMatchMode } from "@/lib/db/enums";
import {
  deleteRule,
  duplicateRule,
  patchSortingRule,
  saveConditions,
} from "./actions";

const POSTGRES_TABLES = ["sorting_rules", "sorting_rule_conditions"];

// ─── Public component: wraps inner in WorkspacePresenceProvider ──────────────

export function RulesList({
  rules,
  conditionsByRule,
  days,
  currentUserId,
  currentEmail,
  currentProfile,
}: {
  rules: SortingRule[];
  conditionsByRule: Record<string, SortingRuleCondition[]>;
  days: Day[];
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
      <RulesListInner
        rules={rules}
        conditionsByRule={conditionsByRule}
        days={days}
      />
    </WorkspacePresenceProvider>
  );
}

// ─── Inner component ─────────────────────────────────────────────────────────

function RulesListInner({
  rules: rulesProp,
  conditionsByRule: conditionsByRuleProp,
  days,
}: {
  rules: SortingRule[];
  conditionsByRule: Record<string, SortingRuleCondition[]>;
  days: Day[];
}) {
  const router = useRouter();
  const { peers, selfPeer, onPostgresChanges } = usePresenceContext();
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

  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

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
          const by = (oldRow?.updated_by as string | undefined) ?? "Someone";
          setRules((prev) => prev.filter((r) => r.id !== id));
          setConditionsByRule((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          toast({ intent: "destructive", message: `${by} deleted a sorting rule` });
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
  }, [onPostgresChanges, toast, scheduleRefresh]);

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
    <>
      {toaster}
      <div className="flex flex-col gap-2 font-mono">
        {rules.length > 0 ? (
          <div className="mb-1 flex items-center justify-between">
            <AvatarStack
              peers={peers}
              self={selfPeer}
              popupAlign="left"
            />
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
            peers={peers}
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
    </>
  );
}

// ─── Per-rule row with instant-save scalar fields ─────────────────────────────

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
  peers,
  open,
  onToggle,
}: {
  rule: SortingRule;
  conditions: SortingRuleCondition[];
  days: Day[];
  peers: ReturnType<typeof usePresenceContext>["peers"];
  open: boolean;
  onToggle: () => void;
}) {
  const [duplicating, startDuplicate] = useTransition();
  const [savingConditions, startSaveConditions] = useTransition();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  const { setFocus, pingActivity } = usePresenceContext();

  // ── Conditions: still structural (delete+insert), keep manual save ──
  // Track local conditions state separately from the instant-save scalar fields.
  const [builderConds, setBuilderConds] = useState<BuilderCondition[]>(() =>
    toBuilderConditions(conditions)
  );
  const [matchMode, setMatchMode] = useState<RuleMatchMode>(rule.match_mode);
  const [condsDirty, setCondsDirty] = useState(false);

  // Sync builder conditions when conditions prop changes and user hasn't edited.
  const condServerKey = useMemo(
    () =>
      JSON.stringify(
        conditions.map((c) => [
          c.target,
          c.target_slice,
          c.operator,
          c.reference_type,
          c.reference_value,
        ])
      ),
    [conditions]
  );
  const [lastCondKey, setLastCondKey] = useState(condServerKey);
  if (!condsDirty && lastCondKey !== condServerKey) {
    setBuilderConds(toBuilderConditions(conditions));
    setMatchMode(rule.match_mode);
    setLastCondKey(condServerKey);
  }

  function makeFocusKey(field: string): PresenceFocus {
    return { table: "sorting_rules", recordId: rule.id, field };
  }

  // ── Instant-save scalar fields ──

  const letterField = useInstantField<string>({
    value: rule.letter,
    onCommit: (v) => patchSortingRule(rule.id, { letter: v }),
    onFocusChange: (focused) => setFocus(focused ? makeFocusKey("letter") : null),
    onActivity: pingActivity,
  });

  const slotField = useInstantField<string>({
    value: rule.destination_slot != null ? String(rule.destination_slot) : "",
    onCommit: (v) => {
      const n = v.trim() === "" ? null : Number(v);
      return patchSortingRule(rule.id, {
        destination_slot: Number.isFinite(n) ? (n as number) : null,
      });
    },
    onFocusChange: (focused) => setFocus(focused ? makeFocusKey("destination_slot") : null),
    onActivity: pingActivity,
  });

  const dayField = useInstantField<string>({
    value: rule.day_implemented_id ?? "",
    onCommit: (v) =>
      patchSortingRule(rule.id, { day_implemented_id: v.trim() || null }),
    onFocusChange: (focused) =>
      setFocus(focused ? makeFocusKey("day_implemented_id") : null),
    onActivity: pingActivity,
  });

  const storageField = useInstantField<string>({
    value: rule.storage_location ?? "",
    onCommit: (v) =>
      patchSortingRule(rule.id, { storage_location: v.trim() || null }),
    onFocusChange: (focused) =>
      setFocus(focused ? makeFocusKey("storage_location") : null),
    onActivity: pingActivity,
  });

  const summaryField = useInstantField<string>({
    value: rule.summary ?? "",
    onCommit: (v) => patchSortingRule(rule.id, { summary: v.trim() || null }),
    onFocusChange: (focused) => setFocus(focused ? makeFocusKey("summary") : null),
    onActivity: pingActivity,
  });

  function handleDuplicate(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    const fd = new FormData();
    fd.append("id", rule.id);
    startDuplicate(async () => {
      await duplicateRule(fd);
    });
  }

  async function handleDelete() {
    const ok = await confirmDialog({
      title: "Delete rule?",
      message: `RR-${rule.letter} will be permanently removed.`,
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.append("id", rule.id);
    startSaveConditions(async () => {
      await deleteRule(fd);
    });
  }

  function handleSaveConditions() {
    startSaveConditions(async () => {
      await saveConditions(
        rule.id,
        builderConds.map((c, i) => ({ ...c, position: i + 1 })),
        matchMode
      );
      setCondsDirty(false);
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
              <FieldHighlight peers={peers} focusKey={makeFocusKey("letter")}>
                <Input
                  value={letterField.value}
                  onChange={(e) => {
                    letterField.set(
                      e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1)
                    );
                  }}
                  onFocus={letterField.onFocus}
                  onBlur={letterField.onBlur}
                  maxLength={1}
                  className="h-8 text-center uppercase"
                />
              </FieldHighlight>
            </div>
            <div className="col-span-1 flex flex-col gap-1">
              <Label>Slot</Label>
              <FieldHighlight peers={peers} focusKey={makeFocusKey("destination_slot")}>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={slotField.value}
                  onChange={(e) => slotField.set(e.target.value)}
                  onFocus={slotField.onFocus}
                  onBlur={slotField.onBlur}
                  className="h-8"
                />
              </FieldHighlight>
            </div>
            <div className="col-span-4 flex flex-col gap-1">
              <Label>Day implemented</Label>
              <FieldHighlight peers={peers} focusKey={makeFocusKey("day_implemented_id")}>
                <div onFocus={dayField.onFocus} onBlur={dayField.onBlur}>
                  <Select
                    value={dayField.value}
                    onChange={(e) => dayField.set(e.target.value)}
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
              </FieldHighlight>
            </div>
            <div className="col-span-6 flex flex-col gap-1">
              <Label>Storage location</Label>
              <FieldHighlight peers={peers} focusKey={makeFocusKey("storage_location")}>
                <Input
                  value={storageField.value}
                  onChange={(e) => storageField.set(e.target.value)}
                  onFocus={storageField.onFocus}
                  onBlur={storageField.onBlur}
                  placeholder="e.g. Yellow Bin"
                  className="h-8"
                />
              </FieldHighlight>
            </div>
            <div className="col-span-12 flex flex-col gap-1">
              <Label>Summary</Label>
              <FieldHighlight peers={peers} focusKey={makeFocusKey("summary")}>
                <Textarea
                  value={summaryField.value}
                  onChange={(e) => summaryField.set(e.target.value)}
                  onFocus={summaryField.onFocus}
                  onBlur={summaryField.onBlur}
                  rows={2}
                />
              </FieldHighlight>
            </div>
          </div>

          {/* Conditions: structural mutation — keep explicit save */}
          <ConditionBuilderInline
            conditions={builderConds}
            matchMode={matchMode}
            onChange={(next, mode) => {
              setBuilderConds(next);
              if (mode) setMatchMode(mode);
              setCondsDirty(true);
            }}
          />

          {/* Read-only description of saved conditions */}
          {conditions.length > 0 ? (
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
              disabled={savingConditions}
            >
              Delete rule
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveConditions}
              disabled={savingConditions || !condsDirty}
              variant={condsDirty ? "default" : "secondary"}
            >
              {savingConditions ? "Saving…" : "Save conditions"}
            </Button>
          </div>
        </div>
      ) : null}
      {confirmDialogEl}
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
