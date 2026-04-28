# Testing core rules

Foundation rules for every test in this repo. Every other guide in this
directory assumes these.

## Stack

- **Runner:** Vitest (Node + jsdom envs).
- **Assertions:** Vitest's built-in `expect` plus `@testing-library/jest-dom`
  for DOM matchers (only in jsdom-env tests).
- **DOM:** jsdom (default for `*.test.tsx`); pure logic uses Node env.
- **DB:** real Postgres on a Supabase preview branch via the Supabase MCP, not
  a mock.
- **HTTP:** none currently outbound; if added, mock with `vi.fn` at the call
  site, not at the network.
- **E2E:** Playwright with Chromium only. No cross-browser matrix.

## File layout

```
src/lib/rules/evaluate.ts
src/lib/rules/evaluate.test.ts          # colocated, Node env
src/app/(authed)/inspection/letters/actions.ts
src/app/(authed)/inspection/letters/actions.test.ts   # colocated, integration
tests/
  e2e/
    inspection-letters.spec.ts
    narrative-graph.spec.ts
  fixtures/
    seed.sql                            # deterministic seed for int tests
    builders.ts                         # helpers like makeRuleCondition()
```

Colocate unit and integration tests with the source. E2E sits under `tests/e2e/`
because it spans surfaces.

## Naming

BDD with describe nesting. The leaf `it` reads as a sentence ending in `should`.

```ts
describe("formatInspectionLetterId", () => {
  describe("when variant is provided", () => {
    it("should include the slash-separated variant", () => { /* ... */ });
  });
  describe("when variant is null", () => {
    it("should omit the variant segment", () => { /* ... */ });
  });
});
```

Test file: same basename as source, `.test.ts` or `.test.tsx`. E2E: `<surface>.spec.ts`.

## What to test (and what not to)

See `docs/testing-protocol.md` for policy. Quick decision rule when you're
about to write a test:

1. Could `tsc --noEmit` catch this? → don't test.
2. Is the assertion "the markup looks like X"? → don't test.
3. Is the assertion "this pure function returns the right value for these
   inputs"? → test.
4. Is the assertion "after this server action runs, the DB looks like X and
   `/some/path` was revalidated"? → test.
5. Is the assertion "user can complete this flow end-to-end"? → test, but only
   for the two golden paths in the protocol.

## Mocking

- **Mock**: `next/navigation` (`redirect`), `next/cache` (`revalidatePath`),
  any outbound HTTP, `Math.random`, `Date.now` (use `vi.useFakeTimers`).
- **Don't mock**: anything we own (`@/lib/**`), Supabase responses (use a real
  preview branch), enums, third-party libs (date-fns, zod, react-hook-form).

If a unit test needs a Supabase mock, you are at the wrong layer — push the
test up to integration where the DB is real.

## Test data builders

Don't sprinkle inline literals across every test. Put builders in
`tests/fixtures/builders.ts`:

```ts
export function makeRuleCondition(overrides: Partial<RuleCondition> = {}): RuleCondition {
  return {
    target: "sender_name",
    target_slice: "whole",
    operator: "equals",
    reference_value: "Alice",
    reference_type: "string",
    ...overrides,
  };
}
```

Tests then read like specs:

```ts
const cond = makeRuleCondition({ operator: "is", reference_type: "even" });
```

## Determinism

- Freeze time when the code under test reads `Date.now()` or `new Date()`.
- Stub `Math.random` when testing `randomLetterId`.
- Sort arrays before comparing if the source order isn't part of the contract.
- Never write a test that depends on real network, real time of day, or the
  user's locale.

## Coverage

We don't gate on coverage percentages. We gate on: did this PR change behaviour,
and is that behaviour exercised by a test? Coverage tooling (`vitest --coverage`)
is fine for spotting gaps, not for compliance theatre.
