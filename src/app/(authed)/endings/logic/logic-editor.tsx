"use client";

import { useEffect, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import {
  GHOST_FIELD,
  MUTED_ADD_BTN,
  PanelHeader,
  SaveRevert,
  Spinner,
} from "@/components/panel";
import { cn } from "@/lib/utils";
import type {
  EndingFramework,
  EndingLogicRule,
  EndingLogicRuleCondition,
  EndingVariable,
  EndingVariableValue,
} from "@/lib/db/types";
import { createVariableInline, createValueInline } from "../frameworks/actions";
import {
  createLogicRule,
  deleteLogicRule,
  saveAllLogicRules,
} from "./actions";

type ConditionState = { variable_id: string; value_id: string };

type RuleState = {
  id: string;
  framework_id: string;
  conditions: ConditionState[];
};

export function LogicEditor({
  rules,
  conditions,
  frameworks,
  variables,
  values,
}: {
  rules: EndingLogicRule[];
  conditions: EndingLogicRuleCondition[];
  frameworks: EndingFramework[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
}) {
  const [ruleState, setRuleState] = useState<RuleState[]>(() =>
    rules.map((r) => ({
      id: r.id,
      framework_id: r.framework_id,
      conditions: conditions
        .filter((c) => c.rule_id === r.id)
        .map((c) => ({ variable_id: c.variable_id, value_id: c.value_id })),
    }))
  );
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [creating, startCreating] = useTransition();
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    setRuleState((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const serverIds = new Set(rules.map((r) => r.id));
      const kept = prev.filter((r) => serverIds.has(r.id));
      const keptIds = new Set(kept.map((r) => r.id));
      const additions: RuleState[] = rules
        .filter((r) => !prevById.has(r.id))
        .map((r) => ({
          id: r.id,
          framework_id: r.framework_id,
          conditions: conditions
            .filter((c) => c.rule_id === r.id)
            .map((c) => ({
              variable_id: c.variable_id,
              value_id: c.value_id,
            })),
        }));
      if (additions.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...additions.filter((a) => !keptIds.has(a.id))];
    });
  }, [rules, conditions]);

  function updateRule(id: string, patch: Partial<RuleState>) {
    setRuleState((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
    setDirty(true);
  }

  function setRuleConditions(id: string, conds: ConditionState[]) {
    updateRule(id, { conditions: conds });
  }

  async function handleCreate() {
    startCreating(async () => {
      await createLogicRule();
    });
  }

  function handleDragOver(e: React.DragEvent, overIdx: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === overIdx) return;
    setRuleState((prev) => {
      const next = prev.slice();
      const [moved] = next.splice(dragIndex, 1);
      next.splice(overIdx, 0, moved);
      return next;
    });
    setDragIndex(overIdx);
    setDirty(true);
  }

  function save() {
    const payload = ruleState.map((r, i) => ({
      id: r.id,
      framework_id: r.framework_id,
      sort_order: i,
      conditions: r.conditions.filter((c) => c.variable_id && c.value_id),
    }));
    startTransition(async () => {
      await saveAllLogicRules(payload);
      setDirty(false);
    });
  }

  const anyBlocked = ruleState.some((r) => !r.framework_id);

  function revert() {
    // Re-derive from server props.
    setRuleState(
      rules.map((r) => ({
        id: r.id,
        framework_id: r.framework_id,
        conditions: conditions
          .filter((c) => c.rule_id === r.id)
          .map((c) => ({ variable_id: c.variable_id, value_id: c.value_id })),
      }))
    );
    setDirty(false);
  }

  return (
    <>
      <section className="overflow-hidden rounded-md border border-border bg-card">
        <PanelHeader
          title="Logic"
          dirty={dirty}
          showSaved
          saveRevert={
            <SaveRevert
              dirty={dirty && !anyBlocked}
              pending={pending}
              onSave={save}
              onRevert={revert}
            />
          }
        />
        <div className="flex flex-col gap-3 p-3">
          <p className="text-xs text-muted-foreground">
            Drag to reorder. The first rule whose conditions all match wins. A
            rule with no conditions always matches (use it as a catch-all).
          </p>
          {anyBlocked ? (
            <p className="text-xs text-destructive">
              Every rule needs a framework.
            </p>
          ) : null}

          {ruleState.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No logic rules yet.
            </p>
          ) : null}

          {ruleState.map((rule, idx) => (
            <div
              key={rule.id}
              draggable
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={() => setDragIndex(null)}
              className={cn(
                "overflow-hidden rounded-md border border-border bg-background/40",
                dragIndex === idx && "opacity-60"
              )}
            >
              <RuleEditor
                rule={rule}
                priority={idx + 1}
                frameworks={frameworks}
                variables={variables}
                values={values}
                onFrameworkChange={(fid) =>
                  updateRule(rule.id, { framework_id: fid })
                }
                onSetConditions={(conds) => setRuleConditions(rule.id, conds)}
              />
            </div>
          ))}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || frameworks.length === 0}
              title={
                frameworks.length === 0
                  ? "Create a framework first"
                  : undefined
              }
              className={MUTED_ADD_BTN}
            >
              {creating ? (
                <>
                  <Spinner />
                  Creating…
                </>
              ) : (
                "+ Rule"
              )}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function RuleEditor({
  rule,
  priority,
  frameworks,
  variables,
  values,
  onFrameworkChange,
  onSetConditions,
}: {
  rule: RuleState;
  priority: number;
  frameworks: EndingFramework[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  onFrameworkChange: (frameworkId: string) => void;
  onSetConditions: (conds: ConditionState[]) => void;
}) {
  const [deletePending, startDelete] = useTransition();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();

  function setCondition(index: number, patch: Partial<ConditionState>) {
    const next = rule.conditions.slice();
    next[index] = { ...next[index], ...patch };
    onSetConditions(next);
  }
  function removeCondition(index: number) {
    const next = rule.conditions.slice();
    next.splice(index, 1);
    onSetConditions(next);
  }
  function addCondition() {
    onSetConditions([
      ...rule.conditions,
      { variable_id: "", value_id: "" },
    ]);
  }
  async function handleDelete() {
    const ok = await confirmDialog({
      title: "Delete rule?",
      message: "This rule will be permanently removed.",
      confirmLabel: "Delete",
      intent: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("id", rule.id);
    startDelete(() => deleteLogicRule(fd));
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-2">
        <span
          className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-full bg-muted text-[11px] font-mono text-muted-foreground active:cursor-grabbing"
          title="Drag to reorder"
        >
          {priority}
        </span>
        <Label className="!text-xs uppercase">Play framework</Label>
        <Select
          value={rule.framework_id || ""}
          onChange={(e) => onFrameworkChange(e.target.value)}
          className={cn("h-8 w-auto min-w-[200px]", GHOST_FIELD)}
        >
          <option value="">—</option>
          {frameworks.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
        <span className="flex-1" />
        <button
          type="button"
          disabled={deletePending}
          aria-label="Delete rule"
          title="Delete rule"
          onClick={handleDelete}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </div>

      <div className="flex flex-col gap-1.5 px-3 py-2">
        <Label className="!text-xs">When</Label>
        {rule.conditions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No conditions — always matches (catch-all).
          </p>
        ) : (
          rule.conditions.map((c, idx) => (
            <RuleConditionRow
              key={idx}
              condition={c}
              otherChosenVariableIds={rule.conditions
                .filter((_, i) => i !== idx)
                .map((x) => x.variable_id)
                .filter(Boolean)}
              variables={variables}
              values={values}
              onChange={(patch) => setCondition(idx, patch)}
              onRemove={() => removeCondition(idx)}
            />
          ))
        )}
        <div className="flex justify-start">
          <button type="button" onClick={addCondition} className={MUTED_ADD_BTN}>
            + Condition
          </button>
        </div>
      </div>
      {confirmDialogEl}
    </>
  );
}

const NEW_VARIABLE_SENTINEL = "__new_variable__";
const NEW_VALUE_SENTINEL = "__new_value__";

function RuleConditionRow({
  condition,
  otherChosenVariableIds,
  variables,
  values,
  onChange,
  onRemove,
}: {
  condition: ConditionState;
  otherChosenVariableIds: string[];
  variables: EndingVariable[];
  values: EndingVariableValue[];
  onChange: (patch: Partial<ConditionState>) => void;
  onRemove: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const excludeSet = new Set(otherChosenVariableIds);
  const availableVariables = variables.filter(
    (v) => v.id === condition.variable_id || !excludeSet.has(v.id)
  );
  const variableValues = values.filter(
    (v) => v.variable_id === condition.variable_id
  );

  function handleVariableChange(raw: string) {
    if (raw === NEW_VARIABLE_SENTINEL) {
      const name = window.prompt("Variable name:");
      if (!name || !name.trim()) return;
      startTransition(async () => {
        const res = await createVariableInline({ name: name.trim() });
        onChange({ variable_id: res.id, value_id: "" });
      });
      return;
    }
    onChange({ variable_id: raw, value_id: "" });
  }

  function handleValueChange(raw: string) {
    if (raw === NEW_VALUE_SENTINEL) {
      if (!condition.variable_id) return;
      const text = window.prompt("Value:");
      if (!text || !text.trim()) return;
      startTransition(async () => {
        const res = await createValueInline({
          variable_id: condition.variable_id,
          value: text.trim(),
        });
        onChange({ value_id: res.id });
      });
      return;
    }
    onChange({ value_id: raw });
  }

  return (
    <div className="grid grid-cols-[1fr_1fr_36px] items-center gap-2">
      <Select
        value={condition.variable_id || ""}
        onChange={(e) => handleVariableChange(e.target.value)}
        className={cn("h-8", GHOST_FIELD)}
        disabled={pending}
      >
        <option value="">— pick variable —</option>
        {availableVariables.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
        <option value={NEW_VARIABLE_SENTINEL}>+ New variable…</option>
      </Select>
      <Select
        value={condition.value_id || ""}
        onChange={(e) => handleValueChange(e.target.value)}
        className={cn("h-8", GHOST_FIELD)}
        disabled={pending || !condition.variable_id}
      >
        <option value="">
          {condition.variable_id ? "— pick value —" : "(choose variable first)"}
        </option>
        {variableValues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.value}
          </option>
        ))}
        {condition.variable_id ? (
          <option value={NEW_VALUE_SENTINEL}>+ New value…</option>
        ) : null}
      </Select>
      <button
        type="button"
        aria-label="Remove condition"
        title="Remove condition"
        onClick={onRemove}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
      >
        <Trash2 size={12} aria-hidden />
      </button>
    </div>
  );
}
