# Server action test patterns

For `actions.ts` files — e.g. `src/app/(authed)/inspection/letters/actions.ts`.
These are the highest-ROI integration tests in the repo: they exercise app
code, the Supabase client, RLS, views and the `revalidatePath` contract in one
go. Run with `pnpm test:int`.

## Where they run

Server-action tests are colocated next to source (`actions.ts` →
`actions.test.ts`) and picked up by `vitest.integration.config.ts`. They run
against a **local Supabase stack** (`supabase start`) — see
`tests/integration/README.md`. The seed/cleanup harness lives in
`tests/integration/_helpers.ts`.

## Isolation

There are no per-test savepoints (the Supabase JS client doesn't expose them).
Instead, seed data is namespaced: `seedStoryline()` and friends prefix every
storyline name / day note with `__INT_TEST__`, and `cleanupTestData()` deletes
every prefixed row (FK cascades handle the children). Call `cleanupTestData` in
`beforeAll` and `afterEach`. `vitest.integration.config.ts` sets
`fileParallelism: false` because `storylines.abbreviation` is a unique char(1).

Tables not reachable from a storyline cascade (e.g. `sorting_rules`) aren't
covered by `cleanupTestData` — give those their own explicit cleanup.

## The mock block

`revalidatePath` and `redirect` are part of the action's contract — assert
they're called, don't let them run. And `@/lib/supabase/server` must be
swapped for the test client so the action talks to the test DB. `vi.mock` is
hoisted, so the action import MUST come after the mocks:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import {
  cleanupTestData,
  makeTestClient,
  seedStoryline,
} from "../../../../../tests/integration/_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Only when the action under test calls redirect():
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/supabase/server", async () => {
  const { makeTestClient } = await import(
    "../../../../../tests/integration/_helpers"
  );
  const client = makeTestClient();
  return {
    createSupabaseServerClient: async () => client,
    createSupabaseServiceClient: () => client,
  };
});

// Action imports MUST come after the mocks above.
import { myAction } from "./actions";
```

`makeTestClient()` returns a service-role client — it bypasses RLS by design.
RLS denial is exercised separately in `tests/integration/rls.test.ts`.

## Shape of a test

```ts
describe("moveLetterGroupToDay", () => {
  const sb = makeTestClient();

  beforeAll(async () => { await cleanupTestData(sb); });
  beforeEach(() => { vi.mocked(revalidatePath).mockClear(); });
  afterEach(async () => { await cleanupTestData(sb); });

  it("updates delivery_day_id and revalidates /inspection/letters + /graph", async () => {
    const seed = await seedStoryline(sb, { suffix: "move-day", days: 2 });
    const [, targetDay] = seed.dayIds;

    await moveLetterGroupToDay(seed.groupId, targetDay);

    const { data } = await sb
      .from("letter_groups")
      .select("delivery_day_id")
      .eq("id", seed.groupId)
      .single();
    expect(data?.delivery_day_id).toBe(targetDay);
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });
});
```

## Coverage targets

For each server action:

1. **Happy path** — the mutation lands AND the right paths are revalidated
   (assert both — `expect(revalidatePath).toHaveBeenCalledWith(...)`).
2. **At least one failure / edge path the action handles explicitly** — it
   throws on a bad input, no-ops on a missing row, falls back to a different
   column, exhausts an allocation (e.g. "no free letter").
3. **The no-op contract for instant-save `patch*` actions** — they
   deliberately do NOT call `revalidatePath` (realtime fans the change out to
   peers instead). Assert `expect(revalidatePath).not.toHaveBeenCalled()`.

What you don't need: re-running a mutation for idempotency (that's a SQL
property), every input combination (push to schema-level tests), or RLS denial
from inside a service-role action.

## Anti-patterns

- Mocking the Supabase client's query results. If you're doing that, the test
  belongs in the unit layer (`core.md`) or it's testing the wrong thing.
- Asserting on the shape of Supabase error objects — they change between SDK
  versions. Assert the post-condition in the DB, not the error string.
- Reusing ids across tests. Each test seeds its own namespaced storyline.
