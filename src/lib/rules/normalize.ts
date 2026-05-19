import {
  REFERENCE_TYPES_WITH_VALUE,
  RULE_REFERENCE_TYPE_LABELS,
  RULE_TARGET_SLICES,
  targetKind,
  type RuleOperator,
  type RuleReferenceType,
  type RuleTarget,
  type RuleTargetSlice,
} from "@/lib/db/enums";

export type EditableCondition = {
  target: RuleTarget;
  target_slice: RuleTargetSlice;
  operator: RuleOperator;
  reference_type: RuleReferenceType;
  reference_value: string | null;
};

/** Back-compat alias for EditableCondition. */
export type BuilderCondition = EditableCondition;

// ─── per-target matrix ───────────────────────────────────────────────────────
//
// Driving principle (per the product spec):
//   `=` / `≠`     → user-typed values   (text or number input)
//   `is` / `is_not` → predetermined-set picks (type-checks like "a letter", OR
//                    known-value dropdowns like a city / nation / true-false)
//
// The matrix here encodes which (operator, reference-type) combinations the
// editor offers for each target+slice combination, and `normalizeCondition`
// snaps any out-of-spec condition back to a valid shape.

/** Slices offered for this target. Sliceless targets resolve to ["whole"] —
 *  the UI hides the slice segment for those. */
export function slicesFor(target: RuleTarget): RuleTargetSlice[] {
  const k = targetKind(target);
  if (k === "nation" || k === "day" || k === "counterfeit") return ["whole"];
  return [...RULE_TARGET_SLICES];
}

/** Operators offered for a (target, slice). */
export function operatorsFor(
  target: RuleTarget,
  slice: RuleTargetSlice
): RuleOperator[] {
  const k = targetKind(target);
  switch (k) {
    case "counterfeit":
      return ["is", "is_not"];
    case "nation":
    case "day":
      // Both are predetermined-set pickers (nation list / weekday list).
      return ["is", "is_not"];
    case "name":
      if (slice === "whole") {
        return ["equals", "not_equals", "contains", "not_contains"];
      }
      return ["is", "is_not"];
    case "city_code":
      if (slice === "whole") {
        return ["equals", "not_equals", "contains", "not_contains"];
      }
      // First/last char now spans the same matrix as citizen_id — a letter,
      // this letter, these letters, a/this/these number(s), an even/odd number.
      return ["is", "is_not"];
    case "citizen_id":
      if (slice === "whole") {
        return ["equals", "not_equals", "contains", "not_contains"];
      }
      // First/last char: both the type-check family (is/is_not) and the
      // numeric range comparisons.
      return ["is", "is_not", "gt", "gte", "lt", "lte"];
    case "city_name":
      if (slice === "whole") {
        return ["is", "is_not", "contains", "not_contains"];
      }
      return ["is", "is_not"];
  }
}

/** Reference types offered for a (target, slice, operator) combination. */
export function referenceTypesFor(
  target: RuleTarget,
  slice: RuleTargetSlice,
  operator: RuleOperator
): RuleReferenceType[] {
  const k = targetKind(target);

  if (k === "counterfeit") return ["true", "false"];
  if (k === "nation" || k === "day") return ["string"];

  if (
    operator === "gt" ||
    operator === "gte" ||
    operator === "lt" ||
    operator === "lte"
  ) {
    return ["number"];
  }
  if (operator === "contains" || operator === "not_contains") {
    return ["string"];
  }
  if (operator === "equals" || operator === "not_equals") {
    return ["string"];
  }

  // operator is `is` or `is_not`
  if (k === "name") {
    return ["string", "letter_set"]; // {this letter, these letters}
  }
  if (k === "citizen_id" || k === "city_code") {
    // Full char-family on a single sliced character:
    //   a letter, this letter, these letters,
    //   a number, this number, these numbers,
    //   an even number, an odd number.
    return [
      "letter",
      "string",
      "letter_set",
      "any_number",
      "digit",
      "digit_set",
      "even",
      "odd",
    ];
  }
  if (k === "city_name") {
    if (slice === "whole") return ["string"]; // city dropdown
    return ["string", "letter_set"];
  }
  return ["string"];
}

/** True when the comparator UI should render a reference-type picker (i.e.
 *  there's more than one reference-type to choose from). */
export function hasReferenceTypePicker(
  target: RuleTarget,
  slice: RuleTargetSlice,
  operator: RuleOperator
): boolean {
  return referenceTypesFor(target, slice, operator).length > 1;
}

/** Context-aware label for a reference type in the comparator picker. Falls
 *  back to RULE_REFERENCE_TYPE_LABELS for the general case. */
export function comparatorLabel(
  refType: RuleReferenceType,
  target: RuleTarget,
  slice: RuleTargetSlice
): string {
  const k = targetKind(target);
  if (
    refType === "string" &&
    (slice === "first_char" || slice === "last_char") &&
    (k === "name" ||
      k === "city_code" ||
      k === "city_name" ||
      k === "citizen_id")
  ) {
    return "this letter";
  }
  return RULE_REFERENCE_TYPE_LABELS[refType];
}

// ─── letter-set / digit-set helpers ──────────────────────────────────────────

/** Canonical comma-joined form of a "these letters" raw input — filtered to
 *  alphanumerics, uppercased, deduped, sorted. e.g. "a,B,c,a" → "A,B,C". */
export function normalizeLetterSet(raw: string): string {
  const chars = new Set<string>();
  for (const ch of raw) {
    if (/[A-Za-z0-9]/.test(ch)) chars.add(ch.toUpperCase());
  }
  return [...chars].sort().join(",");
}

/** Canonical comma-joined form of a "these numbers" raw input — filtered to
 *  digits only, deduped, sorted. e.g. "5,1,5,3" → "1,3,5". */
export function normalizeDigitSet(raw: string): string {
  const chars = new Set<string>();
  for (const ch of raw) {
    if (/[0-9]/.test(ch)) chars.add(ch);
  }
  return [...chars].sort().join(",");
}

/** Normalize a comma-joined character-set value by reference-type. */
export function normalizeCharSet(raw: string, refType: string): string {
  if (refType === "digit_set") return normalizeDigitSet(raw);
  return normalizeLetterSet(raw);
}

/** Parse a stored letter-set value into its character array. */
export function parseLetterSet(stored: string | null): string[] {
  if (!stored) return [];
  return stored
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Render a letter-set for display — commas with spaces (e.g. "A, B, C"). */
export function displayLetterSet(stored: string | null): string {
  return parseLetterSet(stored).join(", ");
}

// ─── normalization ───────────────────────────────────────────────────────────

/** Force a condition into a self-consistent shape per the matrix. */
export function normalizeCondition(c: EditableCondition): EditableCondition {
  const allowedSlices = slicesFor(c.target);
  const target_slice = allowedSlices.includes(c.target_slice)
    ? c.target_slice
    : allowedSlices[0];

  const allowedOps = operatorsFor(c.target, target_slice);
  const operator = allowedOps.includes(c.operator) ? c.operator : allowedOps[0];

  const allowedRefs = referenceTypesFor(c.target, target_slice, operator);
  const reference_type = allowedRefs.includes(c.reference_type)
    ? c.reference_type
    : allowedRefs[0];

  const takesValue = REFERENCE_TYPES_WITH_VALUE.includes(reference_type);
  return {
    target: c.target,
    target_slice,
    operator,
    reference_type,
    reference_value: takesValue ? c.reference_value : null,
  };
}

export function isNumericValue(s: string): boolean {
  if (s.trim() === "") return false;
  return Number.isFinite(Number(s));
}
