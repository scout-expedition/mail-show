# Unit test patterns

For pure functions in `src/lib/**`. These are the highest-ROI tests in the
repo. Read `core.md` first.

## What lives here

| Module | What to test |
|---|---|
| `src/lib/rules/evaluate.ts` | `evaluateCondition` for every operator/reference combo permitted by `VALID_OPERATOR_REFERENCES`; `evaluateRule` for `all`/`any`/empty. |
| `src/lib/playthrough/variables.ts` | `tallyVariables` sums each impact column; `combined_national` excludes Epicenter; empty input returns `ZERO_VARIABLES`. |
| `src/lib/ids.ts` | All four formatters across present/absent variant + piece + lpad cases; `formatRfidPayload` zero-pads to 6. |
| `src/lib/citizen-id.ts` | Format + parse round-trip; rejects malformed input. |
| `src/lib/letter-groups.ts` | Whatever it exports — mirror its public surface. |
| `src/lib/graph-overlay.ts` | Layout math: column × day → coordinate. |
| `src/lib/color.ts` | Deterministic hashing / contrast helpers. |
| `src/lib/utils.ts` | `lpad` and any other helpers; `cn` is third-party. |

## Shape of a unit test

```ts
import { describe, it, expect } from "vitest";
import { evaluateCondition } from "./evaluate";
import { makeRuleCondition, makeRuleContext } from "../../../tests/fixtures/builders";

describe("evaluateCondition", () => {
  describe("operator: equals", () => {
    it("should match exactly", () => {
      const cond = makeRuleCondition({ reference_value: "Alice" });
      const ctx = makeRuleContext({ sender_name: "Alice" });
      expect(evaluateCondition(cond, ctx)).toBe(true);
    });

    it("should not match a different value", () => {
      const cond = makeRuleCondition({ reference_value: "Alice" });
      const ctx = makeRuleContext({ sender_name: "Bob" });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });

    it("should return false when target value is null", () => {
      const cond = makeRuleCondition({ reference_value: "Alice" });
      const ctx = makeRuleContext({ sender_name: null });
      expect(evaluateCondition(cond, ctx)).toBe(false);
    });
  });
});
```

## Coverage checklist for `evaluate.ts`

A complete test for the rule evaluator covers, at minimum:

- Every operator in `RULE_OPERATORS`: `equals`, `contains`, `is`, `gt`, `gte`,
  `lt`, `lte`.
- For `is`: every `reference_type` — `string`, `number`, `letter`, `even`,
  `odd`, `true`, `false`.
- Slice variants: `whole`, `first_char`, `last_char`.
- `is_counterfeit` boolean target.
- Null target value short-circuits to `false`.
- `evaluateRule` mode `all` returns false on any failing condition.
- `evaluateRule` mode `any` returns true on any passing condition.
- `evaluateRule` with `conditions: []` returns `false` (current contract — see
  `evaluate.ts:107`; if this changes, the test changes).

## Coverage checklist for `variables.ts`

- Empty actions array → all zeros.
- Single action with each impact column non-zero is summed correctly.
- `combined_national = folos + emberlyn + spokgrad + pelico` and **does not**
  include `epicenter`. Pin this with a test that sets `impact_epicenter` to a
  large value and asserts `combined_national` is unchanged.

## Coverage checklist for `ids.ts`

- `formatInspectionLetterId`:
  - Single-letter group with `variant: null, piece: null` → `L-{abbr}{seq}`.
  - With variant only → `L-{abbr}{seq}/a`.
  - With piece only → `L-{abbr}{seq}1`.
  - With both → `L-{abbr}{seq}/a1`.
- `formatReportId` always emits `R-{abbr}{seq}/{variant}`.
- `formatSortingLetterId` zero-pads `sortId` to 2 digits via `lpad`.
- `formatRfidPayload(7)` → `"SL000007"`.

## Tips

- One `expect` per `it` when you can. Multiple is fine when the assertions
  describe one behaviour together; don't pad a test with unrelated checks.
- Prefer table-driven tests for operator matrices:

  ```ts
  it.each([
    ["equals", "Alice", "Alice", true],
    ["equals", "Alice", "Bob", false],
    ["contains", "Alice", "Ali", true],
  ])("operator %s on %s vs %s → %s", (op, a, b, expected) => { /* ... */ });
  ```

- Don't test `lpad` separately if every formatter that uses it already exercises
  it. Test the public-surface formatters; `lpad` rides along.
