import type {
  RuleMatchMode,
  RuleOperator,
  RuleReferenceType,
  RuleTarget,
  RuleTargetSlice,
} from "@/lib/db/enums";

/** The context a condition can look at: a sorting letter + a little ambient state. */
export interface RuleContext {
  sender_name: string | null;
  sender_citizen_id: string | null;
  sender_city_name: string | null;
  sender_city_code: string | null;
  sender_nation: string | null;
  recipient_name: string | null;
  recipient_citizen_id: string | null;
  recipient_city_name: string | null;
  recipient_city_code: string | null;
  recipient_nation: string | null;
  is_counterfeit: boolean;
  current_day_of_week: string | null;
}

export interface RuleCondition {
  target: RuleTarget;
  target_slice: RuleTargetSlice;
  operator: RuleOperator;
  reference_value: string | null;
  reference_type: RuleReferenceType;
}

function pickSlice(value: string, slice: RuleTargetSlice): string {
  if (value === "") return value;
  switch (slice) {
    case "first_char":
      return value.charAt(0);
    case "last_char":
      return value.charAt(value.length - 1);
    default:
      return value;
  }
}

function asTargetValue(
  ctx: RuleContext,
  target: RuleTarget,
  slice: RuleTargetSlice
): { str: string | null; bool: boolean | null } {
  if (target === "is_counterfeit") return { str: null, bool: ctx.is_counterfeit };
  const raw = ctx[target];
  if (raw == null) return { str: null, bool: null };
  if (typeof raw === "boolean") return { str: null, bool: raw };
  return { str: pickSlice(String(raw), slice), bool: null };
}

export function evaluateCondition(cond: RuleCondition, ctx: RuleContext): boolean {
  const { str, bool } = asTargetValue(ctx, cond.target, cond.target_slice);
  const ref = cond.reference_value;

  switch (cond.operator) {
    case "equals":
      if (str == null || ref == null) return false;
      return str === ref;
    case "contains":
      if (str == null || ref == null) return false;
      return str.includes(ref);
    case "is": {
      if (cond.reference_type === "true") return bool === true;
      if (cond.reference_type === "false") return bool === false;
      if (str == null) return false;
      if (cond.reference_type === "number") return /^\d+$/.test(str);
      if (cond.reference_type === "letter") return /^[A-Za-z]+$/.test(str);
      if (cond.reference_type === "even") {
        const n = Number(str);
        return Number.isFinite(n) && n % 2 === 0;
      }
      if (cond.reference_type === "odd") {
        const n = Number(str);
        return Number.isFinite(n) && n % 2 !== 0;
      }
      // is <number> → exact numeric equality
      if (ref == null) return false;
      return Number(str) === Number(ref);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (str == null || ref == null) return false;
      const a = Number(str);
      const b = Number(ref);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (cond.operator === "gt") return a > b;
      if (cond.operator === "gte") return a >= b;
      if (cond.operator === "lt") return a < b;
      return a <= b;
    }
  }
}

export function evaluateRule(
  conditions: RuleCondition[],
  mode: RuleMatchMode,
  ctx: RuleContext
): boolean {
  if (conditions.length === 0) return false;
  if (mode === "all") return conditions.every((c) => evaluateCondition(c, ctx));
  return conditions.some((c) => evaluateCondition(c, ctx));
}
