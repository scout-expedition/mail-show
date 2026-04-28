import { describe, it, expect } from "vitest";
import { evaluateCondition, evaluateRule } from "./evaluate";
import {
  makeRuleCondition,
  makeRuleContext,
} from "../../../tests/fixtures/builders";

describe("evaluateCondition", () => {
  describe("operator: equals", () => {
    it("should return true when target string matches reference", () => {
      const cond = makeRuleCondition({
        operator: "equals",
        reference_value: "Alice",
      });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });

    it("should return false when target string differs from reference", () => {
      const cond = makeRuleCondition({
        operator: "equals",
        reference_value: "Alice",
      });
      const ctx = makeRuleContext({ sender_name: "Bob" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });

    it("should return false when target value is null", () => {
      const cond = makeRuleCondition({
        operator: "equals",
        reference_value: "Alice",
      });
      const ctx = makeRuleContext({ sender_name: null });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
  });

  describe("operator: contains", () => {
    it("should return true when target contains reference substring", () => {
      const cond = makeRuleCondition({
        operator: "contains",
        reference_value: "Ali",
      });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });

    it("should return false when target does not contain reference", () => {
      const cond = makeRuleCondition({
        operator: "contains",
        reference_value: "xyz",
      });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
  });

  describe("operator: is, with reference_type", () => {
    it.each([
      ["even", "4", true],
      ["even", "5", false],
      ["odd", "5", true],
      ["odd", "4", false],
      ["number", "42", true],
      ["number", "abc", false],
      ["letter", "abc", true],
      ["letter", "42", false],
    ] as const)(
      "%s on %s should be %s",
      (reference_type, sender_name, expected) => {
        const cond = makeRuleCondition({
          operator: "is",
          reference_type,
          reference_value: null,
        });
        const ctx = makeRuleContext({ sender_name });
        expect(evaluateCondition(cond, ctx)).toBe(expected);
      }
    );

    it("should return true for is_counterfeit target with reference_type 'true'", () => {
      const cond = makeRuleCondition({
        target: "is_counterfeit",
        operator: "is",
        reference_type: "true",
        reference_value: null,
      });
      const ctx = makeRuleContext({ is_counterfeit: true });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });

    it("should return false for is_counterfeit target with reference_type 'false' when value is true", () => {
      const cond = makeRuleCondition({
        target: "is_counterfeit",
        operator: "is",
        reference_type: "false",
        reference_value: null,
      });
      const ctx = makeRuleContext({ is_counterfeit: true });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });

    it("should return true for exact numeric equality with reference_type 'number' and a value", () => {
      const cond = makeRuleCondition({
        operator: "is",
        reference_type: "number",
        reference_value: "42",
      });
      const ctx = makeRuleContext({ sender_name: "42" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
  });

  describe("numeric comparators", () => {
    it.each([
      ["gt", "5", "3", true],
      ["gt", "3", "5", false],
      ["gte", "5", "5", true],
      ["lt", "3", "5", true],
      ["lte", "5", "5", true],
      ["lte", "6", "5", false],
    ] as const)(
      "%s on %s vs %s should be %s",
      (operator, sender_name, reference_value, expected) => {
        const cond = makeRuleCondition({
          operator,
          reference_value,
        });
        const ctx = makeRuleContext({ sender_name });
        expect(evaluateCondition(cond, ctx)).toBe(expected);
      }
    );

    it("should return false when either side is non-numeric", () => {
      const cond = makeRuleCondition({
        operator: "gt",
        reference_value: "5",
      });
      const ctx = makeRuleContext({ sender_name: "abc" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
  });

  describe("target_slice", () => {
    it("should compare only the first character when slice is 'first_char'", () => {
      const cond = makeRuleCondition({
        target_slice: "first_char",
        operator: "equals",
        reference_value: "A",
      });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });

    it("should compare only the last character when slice is 'last_char'", () => {
      const cond = makeRuleCondition({
        target_slice: "last_char",
        operator: "equals",
        reference_value: "e",
      });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
  });
});

describe("evaluateRule", () => {
  it("should return false when conditions array is empty", () => {
    const ctx = makeRuleContext({ sender_name: "Alice" });
    expect(evaluateRule([], "all", ctx)).toBe(false);
    expect(evaluateRule([], "any", ctx)).toBe(false);
  });

  it("should return true under 'all' when every condition passes", () => {
    const ctx = makeRuleContext({
      sender_name: "Alice",
      recipient_name: "Bob",
    });
    const conditions = [
      makeRuleCondition({ target: "sender_name", reference_value: "Alice" }),
      makeRuleCondition({ target: "recipient_name", reference_value: "Bob" }),
    ];
    expect(evaluateRule(conditions, "all", ctx)).toBe(true);
  });

  it("should return false under 'all' when any condition fails", () => {
    const ctx = makeRuleContext({
      sender_name: "Alice",
      recipient_name: "Carol",
    });
    const conditions = [
      makeRuleCondition({ target: "sender_name", reference_value: "Alice" }),
      makeRuleCondition({ target: "recipient_name", reference_value: "Bob" }),
    ];
    expect(evaluateRule(conditions, "all", ctx)).toBe(false);
  });

  it("should return true under 'any' when at least one condition passes", () => {
    const ctx = makeRuleContext({
      sender_name: "Alice",
      recipient_name: "Carol",
    });
    const conditions = [
      makeRuleCondition({ target: "sender_name", reference_value: "Zed" }),
      makeRuleCondition({ target: "recipient_name", reference_value: "Carol" }),
    ];
    expect(evaluateRule(conditions, "any", ctx)).toBe(true);
  });

  it("should return false under 'any' when no condition passes", () => {
    const ctx = makeRuleContext({ sender_name: "Alice" });
    const conditions = [
      makeRuleCondition({ target: "sender_name", reference_value: "Zed" }),
    ];
    expect(evaluateRule(conditions, "any", ctx)).toBe(false);
  });
});
