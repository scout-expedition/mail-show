import { Badge } from "@/components/ui/badge";
import {
  RULE_OPERATOR_LABELS,
  RULE_TARGET_LABELS,
  RULE_TARGET_SLICE_LABELS,
} from "@/lib/db/enums";
import type { SortingRuleCondition } from "@/lib/db/types";

/** Placeholder text per reference_type when no explicit value is given. */
const REF_HINTS: Record<string, string> = {
  number: "0, 1, 2, 3…",
  even: "2, 4, 6, 8…",
  odd: "1, 3, 5, 7…",
  letter: "A, B, C, D…",
  true: "true",
  false: "false",
};

function referenceLabel(c: SortingRuleCondition): string {
  if (c.reference_value && c.reference_value.trim() !== "")
    return c.reference_value;
  return REF_HINTS[c.reference_type] ?? "";
}

/** Renders a rule condition as natural text with bracketed parts as pills. */
export function ConditionDescription({ c }: { c: SortingRuleCondition }) {
  const sliceLabel =
    c.target_slice === "whole" ? null : RULE_TARGET_SLICE_LABELS[c.target_slice];
  const operator = RULE_OPERATOR_LABELS[c.operator];
  const refLabel = referenceLabel(c);

  return (
    <span className="flex flex-wrap items-center gap-1.5 text-sm">
      <Badge variant="muted">{RULE_TARGET_LABELS[c.target]}</Badge>
      {sliceLabel ? <Badge variant="muted">{sliceLabel}</Badge> : null}
      <span className="text-muted-foreground">{operator}</span>
      {refLabel ? <Badge variant="outline">{refLabel}</Badge> : null}
    </span>
  );
}

/** Renders "And" or "And/Or" as a small connector for the match mode. */
export function MatchModeConnector({ mode }: { mode: "all" | "any" }) {
  return (
    <div className="ml-4 flex items-center">
      <Badge variant="secondary">{mode === "all" ? "And" : "And/Or"}</Badge>
    </div>
  );
}
