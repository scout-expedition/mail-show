import { Badge } from "@/components/ui/badge";
import {
  RULE_OPERATOR_LABELS,
  RULE_TARGET_LABELS,
  RULE_TARGET_SLICE_LABELS,
} from "@/lib/db/enums";
import type { SortingRuleCondition } from "@/lib/db/types";

/** Placeholder text per reference_type when no explicit value is given. */
const REF_HINTS: Record<string, string> = {
  any_number: "a number",
  even: "an even number",
  odd: "an odd number",
  letter: "a letter",
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
    <span className="flex flex-wrap items-center gap-1.5 font-mono text-sm text-sky-400">
      <Badge className="border-transparent bg-sky-400/15 text-sky-400">
        {RULE_TARGET_LABELS[c.target]}
      </Badge>
      {sliceLabel ? (
        <Badge className="border-transparent bg-sky-400/15 text-sky-400">
          {sliceLabel}
        </Badge>
      ) : null}
      <Badge className="border-transparent bg-transparent text-muted-foreground">
        {operator}
      </Badge>
      {refLabel ? (
        <Badge className="border-sky-400/60 bg-transparent text-sky-400">
          {refLabel}
        </Badge>
      ) : null}
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
