"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  BOOLEAN_TARGETS,
  NUMERIC_REFERENCE_TYPES,
  REFERENCE_TYPES_WITH_VALUE,
  RULE_OPERATORS,
  RULE_OPERATOR_LABELS,
  RULE_REFERENCE_TYPE_LABELS,
  RULE_TARGET_LABELS,
  RULE_TARGET_SLICE_LABELS,
  RULE_TARGET_SLICES,
  RULE_TARGETS,
  VALID_OPERATOR_REFERENCES,
  type RuleMatchMode,
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

/** Operators available for a given slice (first/last char can't use "contains"). */
function operatorsForSlice(slice: RuleTargetSlice): readonly RuleOperator[] {
  if (slice === "first_char" || slice === "last_char") {
    return RULE_OPERATORS.filter((o) => o !== "contains");
  }
  return RULE_OPERATORS;
}

/** Reference types available given operator, slice, and boolean-target status. */
function referenceTypesFor(
  operator: RuleOperator,
  slice: RuleTargetSlice,
  isBoolTarget: boolean
): RuleReferenceType[] {
  if (isBoolTarget) return ["true", "false"];
  let allowed = VALID_OPERATOR_REFERENCES[operator].slice();
  // For first/last-char + equals, a single char can't be true/false.
  if (
    (slice === "first_char" || slice === "last_char") &&
    operator === "equals"
  ) {
    allowed = allowed.filter((r) => r !== "true" && r !== "false");
  }
  return allowed;
}

function normalizeCondition(c: BuilderCondition): BuilderCondition {
  const isBool = BOOLEAN_TARGETS.includes(c.target);
  const allowedOps = operatorsForSlice(c.target_slice);
  let operator = allowedOps.includes(c.operator) ? c.operator : allowedOps[0];
  if (isBool) operator = "is";
  const allowedRefs = referenceTypesFor(operator, c.target_slice, isBool);
  let reference_type = c.reference_type;
  // gt/gte/lt/lte always compare against an explicit number.
  if (
    operator === "gt" ||
    operator === "gte" ||
    operator === "lt" ||
    operator === "lte"
  ) {
    reference_type = "number";
  } else if (!allowedRefs.includes(reference_type)) {
    reference_type = allowedRefs[0];
  }
  if (isBool) {
    return {
      ...c,
      operator: "is",
      reference_type: reference_type === "false" ? "false" : "true",
      reference_value: null,
    };
  }
  // Drop value when it's implicit for the type.
  const takesValue = REFERENCE_TYPES_WITH_VALUE.includes(reference_type);
  return {
    ...c,
    operator,
    reference_type,
    reference_value: takesValue ? c.reference_value : null,
  };
}

function isNumericValue(s: string): boolean {
  if (s.trim() === "") return false;
  return Number.isFinite(Number(s));
}

export function ConditionBuilder({
  ruleId,
  initial,
  initialMatchMode,
  saveAction,
}: {
  ruleId: string;
  initial: BuilderCondition[];
  initialMatchMode: RuleMatchMode;
  saveAction: (
    ruleId: string,
    conditions: Array<BuilderCondition & { position: number }>,
    matchMode?: RuleMatchMode
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
  const [matchMode, setMatchMode] = useState<RuleMatchMode>(initialMatchMode);
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
      await saveAction(
        ruleId,
        payload,
        conditions.length > 1 ? matchMode : undefined
      );
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 1500);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
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
        const allowedOps = operatorsForSlice(c.target_slice);
        const allowedRefs = referenceTypesFor(c.operator, c.target_slice, isBoolTarget);
        const usesRawValue =
          REFERENCE_TYPES_WITH_VALUE.includes(c.reference_type) && !isBoolTarget;
        const mustBeNumeric = NUMERIC_REFERENCE_TYPES.includes(c.reference_type);
        const numericError =
          usesRawValue &&
          mustBeNumeric &&
          (c.reference_value == null || !isNumericValue(c.reference_value));
        return (
          <div key={i} className="flex flex-col gap-2">
            <div className="grid grid-cols-12 items-end gap-2 rounded-md border border-border p-3">
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
                  {allowedOps.map((o) => (
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
                    update(i, {
                      reference_type: e.target.value as RuleReferenceType,
                    })
                  }
                  disabled={
                    c.operator === "gt" ||
                    c.operator === "gte" ||
                    c.operator === "lt" ||
                    c.operator === "lte"
                  }
                  className="h-8"
                >
                  {allowedRefs.map((r) => (
                    <option key={r} value={r}>
                      {RULE_REFERENCE_TYPE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <Label>Value</Label>
                {usesRawValue ? (
                  <Input
                    value={c.reference_value ?? ""}
                    onChange={(e) =>
                      update(i, { reference_value: e.target.value })
                    }
                    placeholder={mustBeNumeric ? "0" : ""}
                    className={cn(
                      "h-8",
                      numericError && "ring-2 ring-destructive"
                    )}
                    aria-invalid={numericError}
                  />
                ) : (
                  <Input
                    value="—"
                    disabled
                    readOnly
                    className="h-8 text-muted-foreground"
                  />
                )}
              </div>
              <div className="col-span-1 flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => remove(i)}>
                  ×
                </Button>
              </div>
            </div>

            {i === 0 && conditions.length > 1 ? (
              <div className="ml-4 flex items-center gap-2">
                <Select
                  value={matchMode}
                  onChange={(e) => setMatchMode(e.target.value as RuleMatchMode)}
                  className="h-8 w-auto"
                >
                  <option value="all">And</option>
                  <option value="any">And/Or</option>
                </Select>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Fully-controlled builder used by inline editors. */
export function ConditionBuilderInline({
  conditions,
  matchMode,
  onChange,
}: {
  conditions: BuilderCondition[];
  matchMode: RuleMatchMode;
  onChange: (next: BuilderCondition[], matchMode?: RuleMatchMode) => void;
}) {
  function update(idx: number, patch: Partial<BuilderCondition>) {
    const next = conditions.map((c, i) =>
      i === idx ? normalizeCondition({ ...c, ...patch }) : c
    );
    onChange(next);
  }
  function add() {
    if (conditions.length >= 3) return;
    onChange([
      ...conditions,
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
    onChange(conditions.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Conditions ({conditions.length}/3)
        </h3>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={add}
          disabled={conditions.length >= 3}
        >
          Add condition
        </Button>
      </div>

      {conditions.map((c, i) => {
        const isBoolTarget = BOOLEAN_TARGETS.includes(c.target);
        const allowedOps = operatorsForSlice(c.target_slice);
        const allowedRefs = referenceTypesFor(
          c.operator,
          c.target_slice,
          isBoolTarget
        );
        const usesRawValue =
          REFERENCE_TYPES_WITH_VALUE.includes(c.reference_type) &&
          !isBoolTarget;
        const mustBeNumeric = NUMERIC_REFERENCE_TYPES.includes(c.reference_type);
        const numericError =
          usesRawValue &&
          mustBeNumeric &&
          (c.reference_value == null || !isNumericValue(c.reference_value));
        return (
          <div key={i} className="flex flex-col gap-2">
            <div className="grid grid-cols-12 items-end gap-2 rounded-md border border-border p-2">
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
                  {allowedOps.map((o) => (
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
                    update(i, {
                      reference_type: e.target.value as RuleReferenceType,
                    })
                  }
                  disabled={
                    c.operator === "gt" ||
                    c.operator === "gte" ||
                    c.operator === "lt" ||
                    c.operator === "lte"
                  }
                  className="h-8"
                >
                  {allowedRefs.map((r) => (
                    <option key={r} value={r}>
                      {RULE_REFERENCE_TYPE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <Label>Value</Label>
                {usesRawValue ? (
                  <Input
                    value={c.reference_value ?? ""}
                    onChange={(e) =>
                      update(i, { reference_value: e.target.value })
                    }
                    placeholder={mustBeNumeric ? "0" : ""}
                    className={cn(
                      "h-8",
                      numericError && "ring-2 ring-destructive"
                    )}
                    aria-invalid={numericError}
                  />
                ) : (
                  <Input
                    value="—"
                    disabled
                    readOnly
                    className="h-8 text-muted-foreground"
                  />
                )}
              </div>
              <div className="col-span-1 flex justify-end">
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  onClick={() => remove(i)}
                >
                  ×
                </Button>
              </div>
            </div>

            {i === 0 && conditions.length > 1 ? (
              <div className="ml-4 flex items-center gap-2">
                <Select
                  value={matchMode}
                  onChange={(e) =>
                    onChange(conditions, e.target.value as RuleMatchMode)
                  }
                  className="h-8 w-auto"
                >
                  <option value="all">And</option>
                  <option value="any">And/Or</option>
                </Select>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
