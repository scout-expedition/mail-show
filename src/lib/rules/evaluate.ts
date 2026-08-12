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
  sender_first_name: string | null;
  sender_middle_name: string | null;
  sender_last_name: string | null;
  sender_citizen_id: string | null;
  sender_city_name: string | null;
  sender_city_code: string | null;
  sender_nation: string | null;
  recipient_name: string | null;
  recipient_first_name: string | null;
  recipient_middle_name: string | null;
  recipient_last_name: string | null;
  recipient_citizen_id: string | null;
  recipient_city_name: string | null;
  recipient_city_code: string | null;
  recipient_nation: string | null;
  stamp_valid: boolean;
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
  if (target === "stamp_valid") return { str: null, bool: ctx.stamp_valid };
  const raw = ctx[target];
  if (raw == null) return { str: null, bool: null };
  if (typeof raw === "boolean") return { str: null, bool: raw };
  return { str: pickSlice(String(raw), slice), bool: null };
}

/** Equality check that respects the citizen-id-char numeric variant. */
function evalEquals(cond: RuleCondition, ctx: RuleContext): boolean {
  const { str } = asTargetValue(ctx, cond.target, cond.target_slice);
  const ref = cond.reference_value;
  if (str == null || ref == null) return false;
  if (cond.reference_type === "number") {
    const a = Number(str);
    const b = Number(ref);
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  }
  return str === ref;
}

/** Substring check. */
function evalContains(cond: RuleCondition, ctx: RuleContext): boolean {
  const { str } = asTargetValue(ctx, cond.target, cond.target_slice);
  const ref = cond.reference_value;
  if (str == null || ref == null) return false;
  return str.includes(ref);
}

/**
 * The `is` operator dispatches on reference_type:
 *   true/false       — boolean target equality
 *   any_number       — sliced value is numeric
 *   letter           — sliced value is alphabetic
 *   even/odd         — sliced value parses to an even/odd number
 *   string           — sliced value equals reference (predetermined-set pick,
 *                      e.g. a city/nation name, or "this letter")
 *   letter_set       — sliced character is in the comma-joined set
 *   digit            — sliced value equals reference, compared numerically
 *                      (the numeric sibling of `string`/"this letter")
 *   digit_set        — sliced character is in the comma-joined digit set
 *                      (the numeric sibling of `letter_set`/"these letters")
 *   number (legacy)  — exact numeric equality
 */
function evalIs(cond: RuleCondition, ctx: RuleContext): boolean {
  const { str, bool } = asTargetValue(ctx, cond.target, cond.target_slice);
  const ref = cond.reference_value;

  if (cond.reference_type === "true") return bool === true;
  if (cond.reference_type === "false") return bool === false;
  if (str == null) return false;

  if (
    cond.reference_type === "any_number" ||
    cond.reference_type === "number"
  ) {
    // `any_number` is the canonical type-check; `number` (legacy) is treated
    // the same way for back-compat with pre-0004 rows.
    return str.trim() !== "" && Number.isFinite(Number(str));
  }
  if (cond.reference_type === "letter") return /^[A-Za-z]+$/.test(str);
  if (cond.reference_type === "even") {
    const n = Number(str);
    return Number.isFinite(n) && n % 2 === 0;
  }
  if (cond.reference_type === "odd") {
    const n = Number(str);
    return Number.isFinite(n) && n % 2 !== 0;
  }
  if (cond.reference_type === "string") {
    if (ref == null) return false;
    return str === ref;
  }
  if (cond.reference_type === "digit") {
    // Numeric value-equals; tolerant of leading zeros ("07" matches "7").
    if (ref == null) return false;
    const a = Number(str);
    const b = Number(ref);
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  }
  if (
    cond.reference_type === "letter_set" ||
    cond.reference_type === "digit_set"
  ) {
    if (ref == null) return false;
    // Case-insensitive membership: "A,B,C" matches "a" the same as "A".
    // `digit_set` uses identical logic — the only difference between the
    // two is the input mask + label in the editor.
    const target = str.toUpperCase();
    const chars = ref
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0);
    return chars.includes(target);
  }
  return false;
}

export function evaluateCondition(cond: RuleCondition, ctx: RuleContext): boolean {
  switch (cond.operator) {
    case "equals":
      return evalEquals(cond, ctx);
    // Negated operators are pure boolean negations. Note: when the target
    // field is null on the context, evalEquals / evalContains / evalIs all
    // return false, so `not_*` returns true — i.e. "sender_middle_name not_
    // equals 'Lee'" matches every citizen with no middle name. This is the
    // documented semantic; tests pin it.
    case "not_equals":
      return !evalEquals(cond, ctx);
    case "contains":
      return evalContains(cond, ctx);
    case "not_contains":
      return !evalContains(cond, ctx);
    case "is":
      return evalIs(cond, ctx);
    case "is_not":
      return !evalIs(cond, ctx);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const { str } = asTargetValue(ctx, cond.target, cond.target_slice);
      const ref = cond.reference_value;
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
  if (mode === "exclusive") {
    // XOR over all conditions: exactly one must be true. Short-circuits on
    // the second match — no need to evaluate the rest once we know it fails.
    let trueCount = 0;
    for (const c of conditions) {
      if (evaluateCondition(c, ctx)) {
        trueCount++;
        if (trueCount > 1) return false;
      }
    }
    return trueCount === 1;
  }
  // mode === "any"
  return conditions.some((c) => evaluateCondition(c, ctx));
}
