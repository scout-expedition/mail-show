import { describe, it, expect } from "vitest";
import { detectContradictions } from "./contradictions";
import { makeRuleCondition } from "../../../tests/fixtures/builders";
import type { RuleCondition } from "./evaluate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a contradiction whose indices contain exactly the provided set. */
function hasConflict(
  result: ReturnType<typeof detectContradictions>,
  indices: number[],
) {
  const sorted = [...indices].sort((a, b) => a - b).join(",");
  return result.some(
    (r) => [...r.indices].sort((a, b) => a - b).join(",") === sorted,
  );
}

// ---------------------------------------------------------------------------
// matchMode "any" gate
// ---------------------------------------------------------------------------

describe('matchMode "any" gate', () => {
  it("returns [] for any-mode even with obvious equality clash", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_nation",
        operator: "equals",
        reference_value: "Folos",
        reference_type: "string",
      }),
      makeRuleCondition({
        target: "sender_nation",
        operator: "equals",
        reference_value: "Pelico",
        reference_type: "string",
      }),
    ];
    expect(detectContradictions(conditions, "any")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// No-op: empty + single condition
// ---------------------------------------------------------------------------

describe("no contradictions on trivial inputs", () => {
  it("returns [] for empty conditions", () => {
    expect(detectContradictions([], "all")).toEqual([]);
  });

  it("returns [] for a single condition", () => {
    const conditions = [makeRuleCondition({ operator: "equals", reference_value: "X" })];
    expect(detectContradictions(conditions, "all")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// No false positives on a normal 2-condition rule
// ---------------------------------------------------------------------------

describe("no false positives", () => {
  it("different targets — sender_nation equals + recipient_city_name equals", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_nation",
        operator: "equals",
        reference_value: "Folos",
        reference_type: "string",
      }),
      makeRuleCondition({
        target: "recipient_city_name",
        operator: "equals",
        reference_value: "Emberton",
        reference_type: "string",
      }),
    ];
    expect(detectContradictions(conditions, "all")).toEqual([]);
  });

  it("same target + same value (redundancy, not contradiction)", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_nation",
        operator: "equals",
        reference_value: "Folos",
        reference_type: "string",
      }),
      makeRuleCondition({
        target: "sender_nation",
        operator: "equals",
        reference_value: "Folos",
        reference_type: "string",
      }),
    ];
    expect(detectContradictions(conditions, "all")).toEqual([]);
  });

  it("gte 5 + lte 5 is NOT a contradiction (point 5 satisfies both)", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "gte",
        reference_value: "5",
        reference_type: "number",
      }),
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "lte",
        reference_value: "5",
        reference_type: "number",
      }),
    ];
    expect(detectContradictions(conditions, "all")).toEqual([]);
  });

  it("gt 3 + lt 10 — feasible range (3, 10) is non-empty", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "gt",
        reference_value: "3",
        reference_type: "number",
      }),
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "lt",
        reference_value: "10",
        reference_type: "number",
      }),
    ];
    expect(detectContradictions(conditions, "all")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Equality clash
// ---------------------------------------------------------------------------

describe("equality clash", () => {
  it("two equals conditions with different string values → conflict", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "recipient_nation",
        operator: "equals",
        reference_value: "Folos",
        reference_type: "string",
      }),
      makeRuleCondition({
        target: "recipient_nation",
        operator: "equals",
        reference_value: "Pelico",
        reference_type: "string",
      }),
    ];
    const result = detectContradictions(conditions, "all");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
    expect(result[0].message).toContain("Folos");
    expect(result[0].message).toContain("Pelico");
  });

  it("message includes the target label", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "recipient_nation",
        operator: "equals",
        reference_value: "Folos",
        reference_type: "string",
      }),
      makeRuleCondition({
        target: "recipient_nation",
        operator: "equals",
        reference_value: "Pelico",
        reference_type: "string",
      }),
    ];
    const result = detectContradictions(conditions, "all");
    expect(result[0].message).toMatch(/Recipient nation/i);
  });
});

// ---------------------------------------------------------------------------
// Slice-respecting grouping
// ---------------------------------------------------------------------------

describe("slice-respecting grouping", () => {
  it("same target but different slices — no clash", () => {
    // first_char of sender_nation = "F", whole of sender_nation = "Pelico"
    // Different slices → different groups → no contradiction detected
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_nation",
        target_slice: "first_char",
        operator: "equals",
        reference_value: "F",
        reference_type: "string",
      }),
      makeRuleCondition({
        target: "sender_nation",
        target_slice: "whole",
        operator: "equals",
        reference_value: "Pelico",
        reference_type: "string",
      }),
    ];
    expect(detectContradictions(conditions, "all")).toEqual([]);
  });

  it("same target + same slice with clashing values → conflict", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_nation",
        target_slice: "first_char",
        operator: "equals",
        reference_value: "F",
        reference_type: "string",
      }),
      makeRuleCondition({
        target: "sender_nation",
        target_slice: "first_char",
        operator: "equals",
        reference_value: "P",
        reference_type: "string",
      }),
    ];
    const result = detectContradictions(conditions, "all");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Boolean clash
// ---------------------------------------------------------------------------

describe("boolean clash", () => {
  it("is_counterfeit is true + is false → conflict", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "is_counterfeit",
        operator: "is",
        reference_type: "true",
        reference_value: null,
      }),
      makeRuleCondition({
        target: "is_counterfeit",
        operator: "is",
        reference_type: "false",
        reference_value: null,
      }),
    ];
    const result = detectContradictions(conditions, "all");
    expect(result.length).toBe(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
    expect(result[0].message).toMatch(/true and false/i);
    expect(result[0].message).toContain("Is counterfeit");
  });

  it("single is_counterfeit is true — no conflict", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "is_counterfeit",
        operator: "is",
        reference_type: "true",
        reference_value: null,
      }),
    ];
    expect(detectContradictions(conditions, "all")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Numeric range clashes
// ---------------------------------------------------------------------------

describe("numeric range clash", () => {
  it("gt 5 + lt 3 → conflict", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "gt",
        reference_value: "5",
        reference_type: "number",
      }),
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "lt",
        reference_value: "3",
        reference_type: "number",
      }),
    ];
    const result = detectContradictions(conditions, "all");
    expect(result.length).toBe(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
  });

  it("equals 5 + gt 10 → conflict", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "equals",
        reference_value: "5",
        reference_type: "number",
      }),
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "gt",
        reference_value: "10",
        reference_type: "number",
      }),
    ];
    const result = detectContradictions(conditions, "all");
    expect(result.length).toBe(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
  });

  it("gte 5 + lte 4 → conflict", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "gte",
        reference_value: "5",
        reference_type: "number",
      }),
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "lte",
        reference_value: "4",
        reference_type: "number",
      }),
    ];
    const result = detectContradictions(conditions, "all");
    expect(result.length).toBe(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
  });

  it("gt 5 + lt 5 (open bounds meeting at same point) → conflict", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "gt",
        reference_value: "5",
        reference_type: "number",
      }),
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "lt",
        reference_value: "5",
        reference_type: "number",
      }),
    ];
    const result = detectContradictions(conditions, "all");
    expect(result.length).toBe(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Deduplication: equals 5 + equals 7 caught by BOTH equality AND numeric range
// ---------------------------------------------------------------------------

describe("deduplication", () => {
  it("equals 5 + equals 7 produces exactly one conflict record", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "equals",
        reference_value: "5",
        reference_type: "number",
      }),
      makeRuleCondition({
        target: "sender_citizen_id",
        operator: "equals",
        reference_value: "7",
        reference_type: "number",
      }),
    ];
    const result = detectContradictions(conditions, "all");
    expect(result).toHaveLength(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Input not mutated
// ---------------------------------------------------------------------------

describe("input not mutated", () => {
  it("conditions array and objects are not modified", () => {
    const conditions: RuleCondition[] = [
      makeRuleCondition({
        target: "sender_nation",
        operator: "equals",
        reference_value: "Folos",
        reference_type: "string",
      }),
      makeRuleCondition({
        target: "sender_nation",
        operator: "equals",
        reference_value: "Pelico",
        reference_type: "string",
      }),
    ];
    const conditionsBefore = JSON.parse(JSON.stringify(conditions));
    detectContradictions(conditions, "all");
    expect(conditions).toEqual(conditionsBefore);
  });
});

// ---------------------------------------------------------------------------
// Cluster 2 — clashes that involve the new negated operators.
// ---------------------------------------------------------------------------

describe("Cluster 2 negated-operator clashes", () => {
  it("equals X + not_equals X is a contradiction", () => {
    const conds: RuleCondition[] = [
      makeRuleCondition({ target: "sender_first_name", operator: "equals", reference_value: "Alice" }),
      makeRuleCondition({ target: "sender_first_name", operator: "not_equals", reference_value: "Alice" }),
    ];
    const result = detectContradictions(conds, "all");
    expect(result.length).toBe(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
  });

  it("equals X + not_equals Y (different values) is not a contradiction", () => {
    const conds: RuleCondition[] = [
      makeRuleCondition({ target: "sender_first_name", operator: "equals", reference_value: "Alice" }),
      makeRuleCondition({ target: "sender_first_name", operator: "not_equals", reference_value: "Bob" }),
    ];
    expect(detectContradictions(conds, "all")).toEqual([]);
  });

  it("contains X + not_contains X is a contradiction", () => {
    const conds: RuleCondition[] = [
      makeRuleCondition({ target: "sender_first_name", operator: "contains", reference_value: "li" }),
      makeRuleCondition({ target: "sender_first_name", operator: "not_contains", reference_value: "li" }),
    ];
    const result = detectContradictions(conds, "all");
    expect(result.length).toBe(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
  });

  it("is_counterfeit is_not true + is_not false is a contradiction", () => {
    const conds: RuleCondition[] = [
      makeRuleCondition({ target: "is_counterfeit", operator: "is_not", reference_type: "true", reference_value: null }),
      makeRuleCondition({ target: "is_counterfeit", operator: "is_not", reference_type: "false", reference_value: null }),
    ];
    const result = detectContradictions(conds, "all");
    expect(result.length).toBe(1);
    expect(result[0].message).toMatch(/true and false/i);
  });

  it("city is X + is_not X is a contradiction (value picker)", () => {
    const conds: RuleCondition[] = [
      makeRuleCondition({ target: "sender_city_name", operator: "is", reference_type: "string", reference_value: "Pelico" }),
      makeRuleCondition({ target: "sender_city_name", operator: "is_not", reference_type: "string", reference_value: "Pelico" }),
    ];
    const result = detectContradictions(conds, "all");
    expect(result.length).toBe(1);
    expect(hasConflict(result, [0, 1])).toBe(true);
  });
});
