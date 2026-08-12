import { describe, it, expect } from "vitest";
import { evaluateCondition, evaluateRule } from "./evaluate";
import type {
  RuleOperator,
  RuleReferenceType,
  RuleTarget,
} from "../db/enums";
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
      ["any_number", "42", true],
      ["any_number", "abc", false],
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

    it("should return true for stamp_valid target with reference_type 'true'", () => {
      const cond = makeRuleCondition({
        target: "stamp_valid",
        operator: "is",
        reference_type: "true",
        reference_value: null,
      });
      const ctx = makeRuleContext({ stamp_valid: true });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });

    it("should return false for stamp_valid target with reference_type 'false' when value is true", () => {
      const cond = makeRuleCondition({
        target: "stamp_valid",
        operator: "is",
        reference_type: "false",
        reference_value: null,
      });
      const ctx = makeRuleContext({ stamp_valid: true });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });

    // `is_not` over a boolean target is the polarity-flip path that the
    // stamp_valid rename inverts — a fake stamp must satisfy "stamp is not
    // valid" and fail "stamp is not fake".
    it("should return true for 'is_not' true when the stamp is fake", () => {
      const cond = makeRuleCondition({
        target: "stamp_valid",
        operator: "is_not",
        reference_type: "true",
        reference_value: null,
      });
      const ctx = makeRuleContext({ stamp_valid: false });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });

    it("should return false for 'is_not' false when the stamp is fake", () => {
      const cond = makeRuleCondition({
        target: "stamp_valid",
        operator: "is_not",
        reference_type: "false",
        reference_value: null,
      });
      const ctx = makeRuleContext({ stamp_valid: false });
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

describe("name-part targets", () => {
  it("sender_first_name with equals — matches", () => {
    const cond = makeRuleCondition({
      target: "sender_first_name",
      operator: "equals",
      reference_value: "Ada",
    });
    const ctx = makeRuleContext({ sender_first_name: "Ada" });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it("sender_first_name with equals — no match", () => {
    const cond = makeRuleCondition({
      target: "sender_first_name",
      operator: "equals",
      reference_value: "Ada",
    });
    const ctx = makeRuleContext({ sender_first_name: "Beth" });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it("recipient_last_name with contains — matches", () => {
    const cond = makeRuleCondition({
      target: "recipient_last_name",
      operator: "contains",
      reference_value: "son",
    });
    const ctx = makeRuleContext({ recipient_last_name: "Johnson" });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it("null middle name returns false on equals", () => {
    const cond = makeRuleCondition({
      target: "sender_middle_name",
      operator: "equals",
      reference_value: "Lee",
    });
    const ctx = makeRuleContext({ sender_middle_name: null });
    expect(evaluateCondition(cond, ctx)).toBe(false);
  });

  it("first_char slice on recipient_first_name", () => {
    const cond = makeRuleCondition({
      target: "recipient_first_name",
      target_slice: "first_char",
      operator: "equals",
      reference_value: "M",
    });
    const ctx = makeRuleContext({ recipient_first_name: "Maria" });
    expect(evaluateCondition(cond, ctx)).toBe(true);
  });

  it("evaluateRule 'all' mode mixing sender_first_name + recipient_last_name", () => {
    const ctx = makeRuleContext({
      sender_first_name: "Ada",
      recipient_last_name: "Lovelace",
    });
    const conditions = [
      makeRuleCondition({
        target: "sender_first_name",
        operator: "equals",
        reference_value: "Ada",
      }),
      makeRuleCondition({
        target: "recipient_last_name",
        operator: "contains",
        reference_value: "love",
      }),
    ];
    expect(evaluateRule(conditions, "all", ctx)).toBe(false); // case-sensitive: "Lovelace" does not contain "love"
  });

  it("evaluateRule 'all' mode mixing sender_first_name + recipient_last_name — case matched", () => {
    const ctx = makeRuleContext({
      sender_first_name: "Ada",
      recipient_last_name: "Lovelace",
    });
    const conditions = [
      makeRuleCondition({
        target: "sender_first_name",
        operator: "equals",
        reference_value: "Ada",
      }),
      makeRuleCondition({
        target: "recipient_last_name",
        operator: "contains",
        reference_value: "Love",
      }),
    ];
    expect(evaluateRule(conditions, "all", ctx)).toBe(true);
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

  // ─── exclusive (Or — XOR over conditions) ──────────────────────────────────

  // Pinned semantic: negated operators on a null-valued field return true,
  // because the inner positive eval returns false. This is documented in
  // evaluate.ts. If a future change flips to SQL three-valued logic, this
  // test should be updated alongside.
  describe("negated operator on null field", () => {
    it("not_equals matches a null target field", () => {
      const ctx = makeRuleContext({ sender_middle_name: null });
      const cond = makeRuleCondition({
        target: "sender_middle_name",
        operator: "not_equals",
        reference_type: "string",
        reference_value: "Lee",
      });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("not_contains matches a null target field", () => {
      const ctx = makeRuleContext({ sender_middle_name: null });
      const cond = makeRuleCondition({
        target: "sender_middle_name",
        operator: "not_contains",
        reference_type: "string",
        reference_value: "Lee",
      });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("is_not + letter matches a null target field", () => {
      const ctx = makeRuleContext({ sender_middle_name: null });
      const cond = makeRuleCondition({
        target: "sender_middle_name",
        operator: "is_not",
        target_slice: "first_char",
        reference_type: "letter",
        reference_value: null,
      });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
  });

  describe("'exclusive' mode", () => {
    it("returns false when zero conditions pass", () => {
      const ctx = makeRuleContext({
        sender_name: "Alice",
        recipient_name: "Bob",
      });
      const conditions = [
        makeRuleCondition({ target: "sender_name", reference_value: "Zed" }),
        makeRuleCondition({ target: "recipient_name", reference_value: "Carol" }),
      ];
      expect(evaluateRule(conditions, "exclusive", ctx)).toBe(false);
    });

    it("returns true when exactly one condition passes", () => {
      const ctx = makeRuleContext({
        sender_name: "Alice",
        recipient_name: "Carol",
      });
      const conditions = [
        makeRuleCondition({ target: "sender_name", reference_value: "Alice" }),
        makeRuleCondition({ target: "recipient_name", reference_value: "Bob" }),
      ];
      expect(evaluateRule(conditions, "exclusive", ctx)).toBe(true);
    });

    it("returns false when two conditions pass", () => {
      const ctx = makeRuleContext({
        sender_name: "Alice",
        recipient_name: "Bob",
      });
      const conditions = [
        makeRuleCondition({ target: "sender_name", reference_value: "Alice" }),
        makeRuleCondition({ target: "recipient_name", reference_value: "Bob" }),
      ];
      expect(evaluateRule(conditions, "exclusive", ctx)).toBe(false);
    });

    it("returns false when all three conditions pass", () => {
      const ctx = makeRuleContext({
        sender_name: "Alice",
        recipient_name: "Bob",
        sender_nation: "Folos",
      });
      const conditions = [
        makeRuleCondition({ target: "sender_name", reference_value: "Alice" }),
        makeRuleCondition({ target: "recipient_name", reference_value: "Bob" }),
        makeRuleCondition({
          target: "sender_nation",
          operator: "is",
          reference_value: "Folos",
        }),
      ];
      expect(evaluateRule(conditions, "exclusive", ctx)).toBe(false);
    });

    it("returns false on an empty condition set", () => {
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateRule([], "exclusive", ctx)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Cluster 2 — new operators (not_equals / not_contains / is_not) +
// new reference types (letter_set) + the `is` + `string` value-equals overload.
// ---------------------------------------------------------------------------

describe("Cluster 2 operators", () => {
  describe("not_equals", () => {
    it("returns true when values differ", () => {
      const cond = makeRuleCondition({ operator: "not_equals", reference_value: "Alice" });
      const ctx = makeRuleContext({ sender_name: "Bob" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("returns false when values match", () => {
      const cond = makeRuleCondition({ operator: "not_equals", reference_value: "Alice" });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
  });

  describe("not_contains", () => {
    it("returns true when the substring is absent", () => {
      const cond = makeRuleCondition({ operator: "not_contains", reference_value: "xyz" });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("returns false when the substring is present", () => {
      const cond = makeRuleCondition({ operator: "not_contains", reference_value: "li" });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
  });

  describe("is_not + letter type-check", () => {
    it("returns true when the sliced char isn't alphabetic", () => {
      const cond = makeRuleCondition({
        operator: "is_not",
        target_slice: "first_char",
        reference_type: "letter",
        reference_value: null,
      });
      const ctx = makeRuleContext({ sender_name: "1abc" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("returns false when the sliced char IS a letter", () => {
      const cond = makeRuleCondition({
        operator: "is_not",
        target_slice: "first_char",
        reference_type: "letter",
        reference_value: null,
      });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
  });

  describe("is + string (value equals)", () => {
    it("returns true when the value matches", () => {
      const cond = makeRuleCondition({
        operator: "is",
        reference_type: "string",
        reference_value: "Pelico",
      });
      const ctx = makeRuleContext({ sender_name: "Pelico" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("returns false when the value differs", () => {
      const cond = makeRuleCondition({
        operator: "is",
        reference_type: "string",
        reference_value: "Pelico",
      });
      const ctx = makeRuleContext({ sender_name: "Folos" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
  });

  describe("letter_set membership", () => {
    it("matches case-insensitively against the sliced first char", () => {
      const cond = makeRuleCondition({
        operator: "is",
        target_slice: "first_char",
        reference_type: "letter_set",
        reference_value: "A, B, C",
      });
      const ctx = makeRuleContext({ sender_name: "alice" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("rejects a char that isn't in the set", () => {
      const cond = makeRuleCondition({
        operator: "is",
        target_slice: "first_char",
        reference_type: "letter_set",
        reference_value: "A, B, C",
      });
      const ctx = makeRuleContext({ sender_name: "Zoe" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
    it("inverts cleanly under is_not", () => {
      const cond = makeRuleCondition({
        operator: "is_not",
        target_slice: "first_char",
        reference_type: "letter_set",
        reference_value: "A, B, C",
      });
      const ctx = makeRuleContext({ sender_name: "Zoe" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
  });
});

describe("Cluster 3 operators (digit + digit_set + nation/day is)", () => {
  describe("is + digit (value-equals numeric)", () => {
    it("matches when the sliced digit equals the reference", () => {
      const cond = makeRuleCondition({
        target: "sender_citizen_id",
        operator: "is",
        target_slice: "first_char",
        reference_type: "digit",
        reference_value: "5",
      });
      const ctx = makeRuleContext({ sender_citizen_id: "50231" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("does not match a different digit", () => {
      const cond = makeRuleCondition({
        target: "sender_citizen_id",
        operator: "is",
        target_slice: "last_char",
        reference_type: "digit",
        reference_value: "5",
      });
      const ctx = makeRuleContext({ sender_citizen_id: "12347" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
    it("inverts under is_not", () => {
      const cond = makeRuleCondition({
        target: "sender_citizen_id",
        operator: "is_not",
        target_slice: "first_char",
        reference_type: "digit",
        reference_value: "5",
      });
      const ctx = makeRuleContext({ sender_citizen_id: "12347" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
  });

  describe("is + digit_set (set membership)", () => {
    it("matches when the sliced digit is in the set", () => {
      const cond = makeRuleCondition({
        target: "sender_citizen_id",
        operator: "is",
        target_slice: "first_char",
        reference_type: "digit_set",
        reference_value: "1,3,5",
      });
      const ctx = makeRuleContext({ sender_citizen_id: "30000" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("rejects a digit not in the set", () => {
      const cond = makeRuleCondition({
        target: "sender_citizen_id",
        operator: "is",
        target_slice: "first_char",
        reference_type: "digit_set",
        reference_value: "1,3,5",
      });
      const ctx = makeRuleContext({ sender_citizen_id: "20000" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
    it("inverts cleanly under is_not", () => {
      const cond = makeRuleCondition({
        target: "sender_citizen_id",
        operator: "is_not",
        target_slice: "first_char",
        reference_type: "digit_set",
        reference_value: "1,3,5",
      });
      const ctx = makeRuleContext({ sender_citizen_id: "20000" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
  });

  describe("nation + is (predetermined-set picker)", () => {
    it("matches when the recipient nation equals the picked name", () => {
      const cond = makeRuleCondition({
        target: "recipient_nation",
        operator: "is",
        target_slice: "whole",
        reference_type: "string",
        reference_value: "Folos",
      });
      const ctx = makeRuleContext({ recipient_nation: "Folos" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("inverts cleanly under is_not", () => {
      const cond = makeRuleCondition({
        target: "recipient_nation",
        operator: "is_not",
        target_slice: "whole",
        reference_type: "string",
        reference_value: "Folos",
      });
      const ctx = makeRuleContext({ recipient_nation: "Emberlyn" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
  });

  describe("current_day_of_week + is", () => {
    it("matches when the current weekday equals the picked weekday", () => {
      const cond = makeRuleCondition({
        target: "current_day_of_week",
        operator: "is",
        target_slice: "whole",
        reference_type: "string",
        reference_value: "monday",
      });
      const ctx = makeRuleContext({ current_day_of_week: "monday" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
    it("inverts cleanly under is_not", () => {
      const cond = makeRuleCondition({
        target: "current_day_of_week",
        operator: "is_not",
        target_slice: "whole",
        reference_type: "string",
        reference_value: "monday",
      });
      const ctx = makeRuleContext({ current_day_of_week: "friday" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });
  });
});

describe("representative (operator, reference_type) cases", () => {
  // Replaces the old `VALID_OPERATOR_REFERENCES matrix` block: that flat
  // matrix was deleted in the revamp in favor of the target-aware matrix in
  // `src/lib/rules/normalize.ts` (`operatorsFor` + `referenceTypesFor`).
  // The per-target matrix is exercised in `normalize.test.ts`. Here we keep
  // the value-level evaluator cases — each pair shows the evaluator agreeing
  // with the matrix on representative input.
  interface MatrixCase {
    operator: RuleOperator;
    reference_type: RuleReferenceType;
    reference_value: string | null;
    target?: RuleTarget;
    ctx: Parameters<typeof makeRuleContext>[0];
    expected: boolean;
  }

  const CASES: MatrixCase[] = [
    { operator: "equals", reference_type: "string", reference_value: "Alice", ctx: { sender_name: "Alice" }, expected: true },
    { operator: "not_equals", reference_type: "string", reference_value: "Alice", ctx: { sender_name: "Bob" }, expected: true },
    { operator: "contains", reference_type: "string", reference_value: "lic", ctx: { sender_name: "Alice" }, expected: true },
    { operator: "not_contains", reference_type: "string", reference_value: "lic", ctx: { sender_name: "Bob" }, expected: true },
    { operator: "is", reference_type: "any_number", reference_value: null, ctx: { sender_name: "42" }, expected: true },
    { operator: "is", reference_type: "even", reference_value: null, ctx: { sender_name: "42" }, expected: true },
    { operator: "is", reference_type: "odd", reference_value: null, ctx: { sender_name: "42" }, expected: false },
    { operator: "is", reference_type: "letter", reference_value: null, ctx: { sender_name: "42" }, expected: false },
    { operator: "is", reference_type: "true", reference_value: null, target: "stamp_valid", ctx: { stamp_valid: true }, expected: true },
    { operator: "is", reference_type: "false", reference_value: null, target: "stamp_valid", ctx: { stamp_valid: true }, expected: false },
    { operator: "is_not", reference_type: "true", reference_value: null, target: "stamp_valid", ctx: { stamp_valid: false }, expected: true },
    { operator: "is", reference_type: "digit", reference_value: "5", target: "sender_citizen_id", ctx: { sender_citizen_id: "50000" }, expected: true },
    { operator: "is", reference_type: "digit_set", reference_value: "1,3,5", target: "sender_citizen_id", ctx: { sender_citizen_id: "30000" }, expected: true },
    { operator: "is", reference_type: "letter_set", reference_value: "A,B,C", target: "sender_first_name", ctx: { sender_first_name: "alice" }, expected: true },
    { operator: "gt", reference_type: "number", reference_value: "40", ctx: { sender_name: "42" }, expected: true },
    { operator: "gte", reference_type: "number", reference_value: "42", ctx: { sender_name: "42" }, expected: true },
    { operator: "lt", reference_type: "number", reference_value: "40", ctx: { sender_name: "42" }, expected: false },
    { operator: "lte", reference_type: "number", reference_value: "42", ctx: { sender_name: "42" }, expected: true },
  ];

  it.each(CASES)(
    "evaluates '$operator' + '$reference_type' to $expected",
    ({ operator, reference_type, reference_value, target, ctx, expected }) => {
      const cond = makeRuleCondition({
        target: target ?? "sender_name",
        operator,
        reference_type,
        reference_value,
        // For digit / letter_set / digit_set cases on a sliced target, pick
        // the first character so the test data lines up with the comparator.
        target_slice:
          reference_type === "digit" ||
          reference_type === "digit_set" ||
          reference_type === "letter_set"
            ? "first_char"
            : "whole",
      });
      expect(evaluateCondition(cond, makeRuleContext(ctx))).toBe(expected);
    }
  );
});
