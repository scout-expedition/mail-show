import { describe, expect, it } from "vitest";
import { normalizeCondition } from "./normalize";

// `normalizeCondition` snaps an out-of-matrix condition to the closest valid
// shape. The polarity-preservation tests cover the bug from the post-revamp
// review: snapping operator from a list that includes the analogous negation
// should pick the negation, not collapse to the positive default.

describe("normalizeCondition — operator polarity preservation", () => {
  it("snaps is_not → not_equals when moving to a whole-string target", () => {
    // `name first_char is_not letter` → user changes target to whole. The
    // whole-name matrix is [equals, not_equals, contains, not_contains].
    // We should land on not_equals, not equals, so the user's negation
    // intent is preserved.
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
    // recipient_nation only allows [is, is_not]. A condition migrated from
    // a name target with `not_equals` should land on `is_not`, not `is`.
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
});
