"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  BOOLEAN_TARGETS,
  RULE_OPERATORS,
  RULE_OPERATOR_LABELS,
  RULE_REFERENCE_TYPES,
  RULE_TARGET_LABELS,
  RULE_TARGET_SLICE_LABELS,
  RULE_TARGET_SLICES,
  RULE_TARGETS,
  VALID_OPERATOR_REFERENCES,
  type RuleOperator,
  type RuleReferenceType,
  type RuleTarget,
  type RuleTargetSlice,
} from "@/lib/db/enums";

export type BuilderCondition = {
  target: RuleTarget;
  target_slice: RuleTargetSlice;
  operator: RuleOperator;
  reference_type: RuleReferenceType;
  reference_value: string | null;
};

function normalizeCondition(c: BuilderCondition): BuilderCondition {
  // Ensure operator + reference_type are compatible.
  const allowedRefs = VALID_OPERATOR_REFERENCES[c.operator];
  let reference_type = c.reference_type;
  if (!allowedRefs.includes(reference_type)) reference_type = allowedRefs[0];
  if (BOOLEAN_TARGETS.includes(c.target)) {
    return {
      ...c,
      operator: "is",
      reference_type: reference_type === "false" ? "false" : "true",
      reference_value: null,
    };
  }
  return { ...c, reference_type };
}

export function ConditionBuilder({
  ruleId,
  initial,
  saveAction,
}: {
  ruleId: string;
  initial: BuilderCondition[];
  saveAction: (
    ruleId: string,
    conditions: Array<
      BuilderCondition & { position: number }
    >
  ) => Promise<void>;
}) {
  const [conditions, setConditions] = useState<BuilderCondition[]>(
    initial.length > 0
      ? initial
      : [
          {
            target: "recipient_nation",
            target_slice: "whole",
            operator: "equals",
            reference_type: "string",
            reference_value: null,
          },
        ]
  );
  const [isPending, startTransition] = useTransition();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  function update(idx: number, patch: Partial<BuilderCondition>) {
    setConditions((cs) =>
      cs.map((c, i) => (i === idx ? normalizeCondition({ ...c, ...patch }) : c))
    );
  }

  function add() {
    if (conditions.length >= 3) return;
    setConditions((cs) => [
      ...cs,
      {
        target: "recipient_nation",
        target_slice: "whole",
        operator: "equals",
        reference_type: "string",
        reference_value: null,
      },
    ]);
  }

  function remove(idx: number) {
    setConditions((cs) => cs.filter((_, i) => i !== idx));
  }

  function onSave() {
    const payload = conditions.map((c, i) => ({
      ...normalizeCondition(c),
      position: i + 1,
    }));
    startTransition(async () => {
      await saveAction(ruleId, payload);
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 1500);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Conditions ({conditions.length}/3)
        </h3>
        <div className="flex items-center gap-2">
          {savedMsg ? (
            <span className="text-xs text-success">{savedMsg}</span>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={add}
            disabled={conditions.length >= 3}
          >
            Add condition
          </Button>
          <Button size="sm" onClick={onSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save conditions"}
          </Button>
        </div>
      </div>
      {conditions.map((c, i) => {
        const isBoolTarget = BOOLEAN_TARGETS.includes(c.target);
        const allowedRefs = VALID_OPERATOR_REFERENCES[c.operator];
        const usesRawValue =
          (c.operator === "equals" ||
            c.operator === "contains" ||
            c.operator === "gt" ||
            c.operator === "gte" ||
            c.operator === "lt" ||
            c.operator === "lte" ||
            (c.operator === "is" &&
              (c.reference_type === "string" || c.reference_type === "number"))) &&
          !isBoolTarget;
        return (
          <div
            key={i}
            className="grid grid-cols-12 items-end gap-2 rounded-md border border-border p-3"
          >
            <div className="col-span-3 flex flex-col gap-1">
              <Label>Target</Label>
              <Select
                value={c.target}
                onChange={(e) =>
                  update(i, { target: e.target.value as RuleTarget })
                }
                className="h-8"
              >
                {RULE_TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {RULE_TARGET_LABELS[t]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Slice</Label>
              <Select
                value={c.target_slice}
                onChange={(e) =>
                  update(i, { target_slice: e.target.value as RuleTargetSlice })
                }
                disabled={isBoolTarget}
                className="h-8"
              >
                {RULE_TARGET_SLICES.map((s) => (
                  <option key={s} value={s}>
                    {RULE_TARGET_SLICE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Operator</Label>
              <Select
                value={c.operator}
                onChange={(e) =>
                  update(i, { operator: e.target.value as RuleOperator })
                }
                disabled={isBoolTarget}
                className="h-8"
              >
                {RULE_OPERATORS.map((o) => (
                  <option key={o} value={o}>
                    {RULE_OPERATOR_LABELS[o]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Reference type</Label>
              <Select
                value={c.reference_type}
                onChange={(e) =>
                  update(i, { reference_type: e.target.value as RuleReferenceType })
                }
                className="h-8"
              >
                {RULE_REFERENCE_TYPES.filter((r) =>
                  isBoolTarget ? r === "true" || r === "false" : allowedRefs.includes(r)
                ).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1">
              <Label>Value</Label>
              {usesRawValue ? (
                <Input
                  value={c.reference_value ?? ""}
                  onChange={(e) => update(i, { reference_value: e.target.value })}
                  className="h-8"
                />
              ) : (
                <Input
                  value="(implicit)"
                  disabled
                  readOnly
                  className="h-8 text-muted-foreground"
                />
              )}
            </div>
            <div className="col-span-1 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(i)}
              >
                ×
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
