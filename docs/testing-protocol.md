# Testing Protocol

How we test mail-show, what we deliberately don't test, and why. Read this before
writing or asking Claude to write tests. The detailed how-to lives in
`knowledge-base/testing/`; this doc is the policy.

## Goals

- Catch real regressions in the parts of the app that are easy to break and
  hard to notice: the rule evaluator, variable tally, ID formatters, DB views,
  RLS, and the two big editor surfaces (`LettersWorkspace`, `/graph`).
- Keep the suite small enough that one developer can keep it green without it
  becoming a second job.
- Avoid AI-generated test slop: tests that assert on framework internals,
  duplicate type-checker work, or pin snapshots of unstable markup.

## The pyramid

| Layer | Target | Tool | Approx share |
|---|---|---|---|
| Unit | Pure functions in `src/lib/**` | Vitest | ~70% |
| Integration | Server actions + DB views + RLS | Vitest + local Supabase stack | ~25% |
| E2E | One golden path per editor surface | Playwright | ~5% |

The weights are deliberate. With one developer and a stateful UI, every E2E
hour spent maintaining xyflow / slide-panel selectors is an hour not spent on
action-level integration tests that catch ~3x more regressions per line.

## What we test

### Always

- **Pure logic** in `src/lib/**` — `rules/evaluate.ts`, `playthrough/variables.ts`,
  `ids.ts`, `citizen-id.ts`, `letter-groups.ts`, `graph-overlay.ts`, `color.ts`,
  `utils.ts`. These are tiny, deterministic, and load-bearing.
- **The operator/reference matrix** — `VALID_OPERATOR_REFERENCES` in
  `src/lib/db/enums.ts`. The rule UI reads it; the evaluator must agree with it.
  Test that every `(operator, reference_type)` pair the matrix permits actually
  evaluates without throwing for representative inputs.
- **Server actions** that mutate then `revalidatePath` — `inspection/letters/actions.ts`,
  any future `actions.ts` files. Test the mutation **and** that the right paths
  get revalidated.
- **DB views** that produce display IDs — `inspection_letters_view.content_id`,
  `report_segments_view.report_id` + `effective_day_id`,
  `sorting_letters_view.content_id`, `playthrough_variables`. App code treats
  these as truth; if the SQL drifts, every screen lies.
- **RLS** on user-scoped tables — at minimum, that an unauthenticated client
  cannot read or write. Spot-check after schema changes.
- **One golden E2E per editor surface**:
  1. Inspection letters: navigate the 5-panel slide, edit a letter, save, reload.
  2. Narrative graph: drag a letter group to a new day, confirm persistence.

### Sometimes

- New migrations: write a test only if the migration introduces non-trivial
  invariants (a CHECK constraint, a trigger, a view). Plain column adds don't
  need tests.
- New library modules: test on the same trigger as `src/lib/**` above.

### Never

- Component snapshot tests of Tailwind markup. Brittle, no signal.
- Type-only assertions covered by `tsc --noEmit`.
- Supabase client wiring (`createSupabaseServerClient`, `createSupabaseBrowserClient`).
- AppShell, layout, sticky HUD, navigation chrome.
- React-hook-form internals, zod resolver internals, third-party lib internals.
- Anything that requires running the dev server inside a unit test.

If you find yourself reaching for a snapshot, write an assertion instead. If
you can't think of an assertion, the test isn't worth writing.

## Naming

Use BDD-style describe blocks and `should` statements. Group by behaviour, not
by implementation file structure.

```ts
describe("evaluateCondition", () => {
  describe("when operator is 'is' and reference_type is 'even'", () => {
    it("should return true for even numeric strings", () => { /* ... */ });
    it("should return false for odd numeric strings", () => { /* ... */ });
    it("should return false when target value is non-numeric", () => { /* ... */ });
  });
});
```

File naming:
- Unit / integration tests colocate next to source: `evaluate.ts` →
  `evaluate.test.ts`. Server actions: `actions.ts` → `actions.test.ts`.
- E2E specs live under `tests/e2e/<surface>.spec.ts`.

## Mocking policy

Mock at the system boundary. Trust everything inside it.

- **Mock**: `next/navigation` (`redirect`), `next/cache` (`revalidatePath`),
  outbound HTTP (none today, but if added).
- **Don't mock**: our own modules, Supabase responses (use a real local
  Supabase stack), enums, zod schemas, date-fns, react-hook-form.

If a test forces you to mock four of our own modules, the test is at the wrong
layer — push it down to a unit test on the dependency, or up to an integration
test that hits a real DB.

## Database in integration tests

Integration tests run against a **local Supabase stack**. `supabase start`
boots Postgres + GoTrue + PostgREST in Docker and applies every
`supabase/migrations/*.sql` in order, then `supabase/seed.sql` — real RLS,
real views, real triggers, no cloud project touched. CI boots a fresh stack
per run; locally you keep one running and `supabase db reset` after a schema
change. Full setup in `tests/integration/README.md`.

Never point integration tests at the dev or prod project —
`tests/setup.integration.ts` aborts the run if `SUPABASE_TEST_URL` equals
`NEXT_PUBLIC_SUPABASE_URL`. The `__INT_TEST__` row prefix plus cascade-aware
cleanup keep a run isolated, but a failing test that leaves half-state behind
is still far less harmful against a throwaway local stack than a shared DB.

## Running

```sh
pnpm test          # unit only, watchless
pnpm test:watch    # unit, watch mode — what you run while coding
pnpm test:int      # integration; needs a local Supabase stack (see above)
pnpm test:e2e      # Playwright; boots its own server, needs the Supabase stack
pnpm test:all      # unit + int + e2e
```

CI runs all three layers on every PR and on pushes to `main` —
see `.github/workflows/ci.yml`. `pnpm test:int` and `pnpm test:e2e` read
`SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY` and `SUPABASE_TEST_ANON_KEY`:
locally `scripts/test-int.sh` / `scripts/test-e2e.sh` source them from a
gitignored `.env.test.local`; in CI they are exported from `supabase status`.

After substantive changes, run `pnpm typecheck && pnpm lint && pnpm test`.
Same muscle memory as before, plus tests.

## When tests fail

Diagnose, don't delete. A failing test is data: either the code is wrong, the
test is wrong, or the spec changed. Pick one, fix the right thing, write a
note in the commit if the spec changed. Don't `.skip` to ship.

## Open questions / phase 2

- Visual regression on the narrative graph (xyflow renders SVG; pixel diffs
  are tractable). Defer until we have a reason.
- Property-based tests on `evaluateRule` (fast-check). Worth a try once the
  example-based suite is solid.
- Supabase function tests for triggers. Currently no triggers; revisit if any
  are added.
