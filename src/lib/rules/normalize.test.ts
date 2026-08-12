import { describe, expect, it } from "vitest";
import {
  comparatorLabel,
  displayLetterSet,
  hasReferenceTypePicker,
  isNumericValue,
  normalizeCharSet,
  normalizeCondition,
  normalizeDigitSet,
  normalizeLetterSet,
  operatorsFor,
  parseLetterSet,
  referenceTypesFor,
  slicesFor,
} from "./normalize";

// ─── slicesFor ───────────────────────────────────────────────────────────────

describe("slicesFor", () => {
  it("returns [whole] only for sliceless targets", () => {
    expect(slicesFor("recipient_nation")).toEqual(["whole"]);
    expect(slicesFor("current_day_of_week")).toEqual(["whole"]);
    expect(slicesFor("stamp_valid")).toEqual(["whole"]);
  });
  it("returns the full slice list for character-bearing targets", () => {
    expect(slicesFor("sender_first_name")).toEqual([
      "whole",
      "first_char",
      "last_char",
    ]);
    expect(slicesFor("sender_citizen_id")).toEqual([
      "whole",
      "first_char",
      "last_char",
    ]);
    expect(slicesFor("recipient_city_code")).toEqual([
      "whole",
      "first_char",
      "last_char",
    ]);
    expect(slicesFor("recipient_city_name")).toEqual([
      "whole",
      "first_char",
      "last_char",
    ]);
  });
});

// ─── operatorsFor ────────────────────────────────────────────────────────────

describe("operatorsFor", () => {
  it("counterfeit + whole — is/is_not", () => {
    expect(operatorsFor("stamp_valid", "whole")).toEqual(["is", "is_not"]);
  });
  it("nation + whole — is/is_not (post-0044 predetermined-set picker)", () => {
    expect(operatorsFor("sender_nation", "whole")).toEqual(["is", "is_not"]);
    expect(operatorsFor("recipient_nation", "whole")).toEqual(["is", "is_not"]);
  });
  it("day + whole — is/is_not", () => {
    expect(operatorsFor("current_day_of_week", "whole")).toEqual([
      "is",
      "is_not",
    ]);
  });
  it("name whole — value-typed operators only", () => {
    expect(operatorsFor("sender_first_name", "whole")).toEqual([
      "equals",
      "not_equals",
      "contains",
      "not_contains",
    ]);
  });
  it("name first/last char — is/is_not only", () => {
    expect(operatorsFor("sender_first_name", "first_char")).toEqual([
      "is",
      "is_not",
    ]);
    expect(operatorsFor("sender_last_name", "last_char")).toEqual([
      "is",
      "is_not",
    ]);
  });
  it("city_code whole — value-typed operators only", () => {
    expect(operatorsFor("sender_city_code", "whole")).toEqual([
      "equals",
      "not_equals",
      "contains",
      "not_contains",
    ]);
  });
  it("city_code first/last char — is/is_not only", () => {
    expect(operatorsFor("sender_city_code", "first_char")).toEqual([
      "is",
      "is_not",
    ]);
  });
  it("citizen_id whole — value-typed operators only", () => {
    expect(operatorsFor("sender_citizen_id", "whole")).toEqual([
      "equals",
      "not_equals",
      "contains",
      "not_contains",
    ]);
  });
  it("citizen_id first/last char — is/is_not + numeric range", () => {
    expect(operatorsFor("sender_citizen_id", "first_char")).toEqual([
      "is",
      "is_not",
      "gt",
      "gte",
      "lt",
      "lte",
    ]);
  });
  it("city_name whole — is/is_not + contains family", () => {
    expect(operatorsFor("sender_city_name", "whole")).toEqual([
      "is",
      "is_not",
      "contains",
      "not_contains",
    ]);
  });
  it("city_name first/last char — is/is_not", () => {
    expect(operatorsFor("sender_city_name", "last_char")).toEqual([
      "is",
      "is_not",
    ]);
  });
});

// ─── referenceTypesFor ───────────────────────────────────────────────────────

describe("referenceTypesFor", () => {
  it("counterfeit always — {true, false}", () => {
    expect(referenceTypesFor("stamp_valid", "whole", "is")).toEqual([
      "true",
      "false",
    ]);
    expect(referenceTypesFor("stamp_valid", "whole", "is_not")).toEqual([
      "true",
      "false",
    ]);
  });
  it("nation always — [string]", () => {
    expect(referenceTypesFor("recipient_nation", "whole", "is")).toEqual([
      "string",
    ]);
    expect(referenceTypesFor("sender_nation", "whole", "is_not")).toEqual([
      "string",
    ]);
  });
  it("day always — [string]", () => {
    expect(referenceTypesFor("current_day_of_week", "whole", "is")).toEqual([
      "string",
    ]);
  });
  it("numeric operators (gt/gte/lt/lte) — [number]", () => {
    expect(referenceTypesFor("sender_citizen_id", "first_char", "gt")).toEqual(
      ["number"]
    );
    expect(referenceTypesFor("sender_citizen_id", "first_char", "gte")).toEqual(
      ["number"]
    );
    expect(referenceTypesFor("sender_citizen_id", "first_char", "lt")).toEqual(
      ["number"]
    );
    expect(referenceTypesFor("sender_citizen_id", "first_char", "lte")).toEqual(
      ["number"]
    );
  });
  it("contains family — [string]", () => {
    expect(
      referenceTypesFor("sender_first_name", "whole", "contains")
    ).toEqual(["string"]);
    expect(
      referenceTypesFor("sender_first_name", "whole", "not_contains")
    ).toEqual(["string"]);
  });
  it("equals/not_equals on most targets — [string]", () => {
    expect(referenceTypesFor("sender_first_name", "whole", "equals")).toEqual([
      "string",
    ]);
    expect(
      referenceTypesFor("sender_first_name", "whole", "not_equals")
    ).toEqual(["string"]);
  });
  it("name + is/is_not — [string, letter_set]", () => {
    expect(referenceTypesFor("sender_first_name", "first_char", "is")).toEqual([
      "string",
      "letter_set",
    ]);
    expect(
      referenceTypesFor("sender_first_name", "first_char", "is_not")
    ).toEqual(["string", "letter_set"]);
  });
  it("citizen_id + is/is_not on a slice — full char family", () => {
    expect(
      referenceTypesFor("sender_citizen_id", "first_char", "is")
    ).toEqual([
      "letter",
      "string",
      "letter_set",
      "any_number",
      "digit",
      "digit_set",
      "even",
      "odd",
    ]);
  });
  it("city_code + is/is_not on a slice — same full char family as citizen_id", () => {
    expect(
      referenceTypesFor("sender_city_code", "last_char", "is")
    ).toEqual([
      "letter",
      "string",
      "letter_set",
      "any_number",
      "digit",
      "digit_set",
      "even",
      "odd",
    ]);
  });
  it("city_name whole + is — [string] (city-name dropdown)", () => {
    expect(referenceTypesFor("sender_city_name", "whole", "is")).toEqual([
      "string",
    ]);
  });
  it("city_name first/last char + is — [string, letter_set]", () => {
    expect(
      referenceTypesFor("sender_city_name", "first_char", "is")
    ).toEqual(["string", "letter_set"]);
  });
});

// ─── hasReferenceTypePicker ──────────────────────────────────────────────────

describe("hasReferenceTypePicker", () => {
  it("false when there's a single reference type", () => {
    expect(hasReferenceTypePicker("recipient_nation", "whole", "is")).toBe(
      false
    );
    expect(
      hasReferenceTypePicker("current_day_of_week", "whole", "is")
    ).toBe(false);
    expect(
      hasReferenceTypePicker("sender_first_name", "whole", "equals")
    ).toBe(false);
  });
  it("true when 2+ reference types are offered", () => {
    expect(
      hasReferenceTypePicker("sender_first_name", "first_char", "is")
    ).toBe(true);
    expect(
      hasReferenceTypePicker("sender_citizen_id", "first_char", "is")
    ).toBe(true);
    expect(hasReferenceTypePicker("stamp_valid", "whole", "is")).toBe(true);
  });
});

// ─── comparatorLabel ─────────────────────────────────────────────────────────

describe("comparatorLabel", () => {
  it("string at first/last char on name/city/citizen — reads as 'this letter'", () => {
    expect(comparatorLabel("string", "sender_first_name", "first_char")).toBe(
      "this letter"
    );
    expect(comparatorLabel("string", "sender_city_code", "last_char")).toBe(
      "this letter"
    );
    expect(comparatorLabel("string", "sender_citizen_id", "first_char")).toBe(
      "this letter"
    );
    expect(comparatorLabel("string", "sender_city_name", "first_char")).toBe(
      "this letter"
    );
  });
  it("string at whole slice — falls back to default label", () => {
    expect(comparatorLabel("string", "sender_first_name", "whole")).toBe(
      "this string"
    );
  });
  it("digit / digit_set — uses default 'this number' / 'these numbers'", () => {
    expect(comparatorLabel("digit", "sender_citizen_id", "first_char")).toBe(
      "this number"
    );
    expect(
      comparatorLabel("digit_set", "sender_citizen_id", "first_char")
    ).toBe("these numbers");
  });
  it("letter / letter_set — defaults from RULE_REFERENCE_TYPE_LABELS", () => {
    expect(comparatorLabel("letter", "sender_citizen_id", "first_char")).toBe(
      "a letter"
    );
    expect(
      comparatorLabel("letter_set", "sender_first_name", "first_char")
    ).toBe("these letters");
  });
});

// ─── letter/digit set helpers ────────────────────────────────────────────────

describe("normalizeLetterSet", () => {
  it("uppercases, dedupes, sorts", () => {
    expect(normalizeLetterSet("a,B,c,a")).toBe("A,B,C");
  });
  it("strips non-alphanumeric noise (commas, spaces, punctuation)", () => {
    expect(normalizeLetterSet("a, b; c.")).toBe("A,B,C");
    expect(normalizeLetterSet(" ")).toBe("");
  });
  it("accepts digits too (alphanumeric filter)", () => {
    expect(normalizeLetterSet("a,1,B,2")).toBe("1,2,A,B");
  });
  it("returns '' for an empty / whitespace input", () => {
    expect(normalizeLetterSet("")).toBe("");
    expect(normalizeLetterSet("   ")).toBe("");
  });
});

describe("normalizeDigitSet", () => {
  it("dedupes + sorts digit set", () => {
    expect(normalizeDigitSet("5,1,5,3")).toBe("1,3,5");
  });
  it("strips letters and punctuation", () => {
    expect(normalizeDigitSet("a1B2c3")).toBe("1,2,3");
  });
  it("returns '' for empty / no-digit input", () => {
    expect(normalizeDigitSet("")).toBe("");
    expect(normalizeDigitSet("abc")).toBe("");
  });
});

describe("normalizeCharSet", () => {
  it("dispatches to digit when refType is digit_set", () => {
    expect(normalizeCharSet("5,1,5,3", "digit_set")).toBe("1,3,5");
    expect(normalizeCharSet("a1B2c3", "digit_set")).toBe("1,2,3");
  });
  it("dispatches to letter_set for everything else", () => {
    expect(normalizeCharSet("a,B,c,a", "letter_set")).toBe("A,B,C");
    expect(normalizeCharSet("a,B,c", "string")).toBe("A,B,C");
  });
});

describe("parseLetterSet", () => {
  it("splits and trims a comma-joined set", () => {
    expect(parseLetterSet("A, B, C")).toEqual(["A", "B", "C"]);
  });
  it("drops empty entries", () => {
    expect(parseLetterSet("A,, B,")).toEqual(["A", "B"]);
  });
  it("returns [] for null / empty input", () => {
    expect(parseLetterSet(null)).toEqual([]);
    expect(parseLetterSet("")).toEqual([]);
  });
});

describe("displayLetterSet", () => {
  it("renders with comma + space", () => {
    expect(displayLetterSet("A,B,C")).toBe("A, B, C");
  });
  it("renders '' for null", () => {
    expect(displayLetterSet(null)).toBe("");
  });
});

// ─── isNumericValue ──────────────────────────────────────────────────────────

describe("isNumericValue", () => {
  it("accepts integers, decimals, signed forms", () => {
    expect(isNumericValue("0")).toBe(true);
    expect(isNumericValue("42")).toBe(true);
    expect(isNumericValue("-3")).toBe(true);
    expect(isNumericValue("1.5")).toBe(true);
  });
  it("rejects empty / whitespace / non-numeric", () => {
    expect(isNumericValue("")).toBe(false);
    expect(isNumericValue("   ")).toBe(false);
    expect(isNumericValue("abc")).toBe(false);
  });
});

// ─── normalizeCondition — operator polarity preservation ─────────────────────

describe("normalizeCondition — operator polarity preservation", () => {
  it("snaps is_not → not_equals when moving to a whole-string target", () => {
    const out = normalizeCondition({
      target: "sender_first_name",
      target_slice: "whole",
      operator: "is_not",
      reference_type: "letter",
      reference_value: null,
    });
    expect(out.operator).toBe("not_equals");
  });

  it("snaps not_equals → is_not when moving to a target whose matrix only allows is/is_not", () => {
    const out = normalizeCondition({
      target: "recipient_nation",
      target_slice: "whole",
      operator: "not_equals",
      reference_type: "string",
      reference_value: "Folos",
    });
    expect(out.operator).toBe("is_not");
  });

  it("snaps is → equals (positive polarity preserved)", () => {
    const out = normalizeCondition({
      target: "sender_first_name",
      target_slice: "whole",
      operator: "is",
      reference_type: "string",
      reference_value: "Alice",
    });
    expect(out.operator).toBe("equals");
  });

  it("keeps the operator unchanged when it's already allowed", () => {
    const out = normalizeCondition({
      target: "recipient_nation",
      target_slice: "whole",
      operator: "is_not",
      reference_type: "string",
      reference_value: "Emberlyn",
    });
    expect(out.operator).toBe("is_not");
  });

  it("falls back to allowedOps[0] when neither polarity is represented", () => {
    // citizen_id whole only allows [equals, not_equals, contains, not_contains].
    // A stale `gt` from a renamed target should still land somewhere valid.
    const out = normalizeCondition({
      target: "sender_citizen_id",
      target_slice: "whole",
      operator: "gt",
      reference_type: "number",
      reference_value: "5",
    });
    expect(out.operator).toBe("equals");
  });

  it("keeps a negation that's already valid in the matrix unchanged", () => {
    const out = normalizeCondition({
      target: "sender_first_name",
      target_slice: "whole",
      operator: "not_contains",
      reference_type: "string",
      reference_value: "lic",
    });
    expect(out.operator).toBe("not_contains");
  });
});

// ─── normalizeCondition — slice / ref_type / reference_value snaps ──────────

describe("normalizeCondition — slice + ref_type + reference_value snaps", () => {
  it("snaps an invalid slice to the first allowed slice", () => {
    const out = normalizeCondition({
      target: "recipient_nation",
      target_slice: "first_char", // not allowed on nation
      operator: "is",
      reference_type: "string",
      reference_value: "Folos",
    });
    expect(out.target_slice).toBe("whole");
  });

  it("snaps an invalid ref_type to the first allowed type", () => {
    const out = normalizeCondition({
      target: "sender_first_name",
      target_slice: "whole",
      operator: "equals",
      reference_type: "letter", // letter isn't valid for equals on a whole name
      reference_value: "Alice",
    });
    expect(out.reference_type).toBe("string");
  });

  it("clears reference_value when the chosen ref_type doesn't take a value", () => {
    const out = normalizeCondition({
      target: "sender_citizen_id",
      target_slice: "first_char",
      operator: "is",
      reference_type: "letter",
      reference_value: "anything",
    });
    expect(out.reference_value).toBeNull();
  });

  it("keeps reference_value when the chosen ref_type does take a value", () => {
    const out = normalizeCondition({
      target: "sender_first_name",
      target_slice: "whole",
      operator: "equals",
      reference_type: "string",
      reference_value: "Alice",
    });
    expect(out.reference_value).toBe("Alice");
  });

  it("digit ref_type keeps reference_value (it's value-bearing)", () => {
    const out = normalizeCondition({
      target: "sender_citizen_id",
      target_slice: "first_char",
      operator: "is",
      reference_type: "digit",
      reference_value: "5",
    });
    expect(out.reference_value).toBe("5");
  });

  it("digit_set ref_type keeps reference_value (it's value-bearing)", () => {
    const out = normalizeCondition({
      target: "sender_citizen_id",
      target_slice: "first_char",
      operator: "is",
      reference_type: "digit_set",
      reference_value: "1,3,5",
    });
    expect(out.reference_value).toBe("1,3,5");
  });

  it("any_number ref_type clears reference_value (it's type-check-only)", () => {
    const out = normalizeCondition({
      target: "sender_citizen_id",
      target_slice: "first_char",
      operator: "is",
      reference_type: "any_number",
      reference_value: "ignored",
    });
    expect(out.reference_value).toBeNull();
  });

  it("even/odd type-checks clear reference_value", () => {
    expect(
      normalizeCondition({
        target: "sender_citizen_id",
        target_slice: "first_char",
        operator: "is",
        reference_type: "even",
        reference_value: "ignored",
      }).reference_value
    ).toBeNull();
    expect(
      normalizeCondition({
        target: "sender_citizen_id",
        target_slice: "first_char",
        operator: "is",
        reference_type: "odd",
        reference_value: "ignored",
      }).reference_value
    ).toBeNull();
  });

  it("counterfeit + true / false clears reference_value", () => {
    expect(
      normalizeCondition({
        target: "stamp_valid",
        target_slice: "whole",
        operator: "is",
        reference_type: "true",
        reference_value: "x",
      }).reference_value
    ).toBeNull();
    expect(
      normalizeCondition({
        target: "stamp_valid",
        target_slice: "whole",
        operator: "is",
        reference_type: "false",
        reference_value: "x",
      }).reference_value
    ).toBeNull();
  });
});
