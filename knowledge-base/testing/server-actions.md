# Server action test patterns

For files like `src/app/(authed)/inspection/letters/actions.ts`. These are the
highest-ROI integration tests in the repo: they exercise app code, the
Supabase client, RLS, views, and the `revalidatePath` contract in one go.

## Setup

Integration tests run against a Supabase preview branch:

1. CI / `pnpm test:int` calls a setup helper (`tests/fixtures/branch.ts`) that
   uses the Supabase MCP to create a branch off main, applies all migrations
   in `supabase/migrations/`, and runs `tests/fixtures/seed.sql`.
2. `process.env.NEXT_PUBLIC_SUPABASE_URL` and the service-role key are
   overridden to point at the branch for the duration of the run.
3. `globalTeardown` deletes the branch.

Per-test isolation: each test wraps its work in a savepoint and rolls back. If
that's not feasible (Supabase JS doesn't expose savepoints), seed data must be
namespaced (e.g. each test uses unique storyline abbreviations) so tests don't
collide.

## Mocking Next.js

`revalidatePath` and `redirect` are part of the contract — we want to verify
they're called, not let them actually run.

```ts
import { vi, beforeEach, expect } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { revalidatePath } from "next/cache";

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
});
```

## Shape of a server action test

```ts
import { describe, it, expect } from "vitest";
import { revalidatePath } from "next/cache";
import { moveLetterGroupToDay } from "./actions";
import { getTestSupabase, seedStoryline } from "../../../../../tests/fixtures/branch";

describe("moveLetterGroupToDay", () => {
  it("should update the group's day_id and revalidate /inspection/letters and /graph", async () => {
    const sb = getTestSupabase();
    const { groupId, targetDayId } = await seedStoryline(sb, {
      storylineAbbr: "TEST",
      groups: [{ name: "Onboarding" }],
      days: 3,
    });

    await moveLetterGroupToDay({ groupId, dayId: targetDayId });

    const { data: group } = await sb
      .from("letter_groups")
      .select("day_id")
      .eq("id", groupId)
      .single();

    expect(group?.day_id).toBe(targetDayId);
    expect(revalidatePath).toHaveBeenCalledWith("/inspection/letters");
    expect(revalidatePath).toHaveBeenCalledWith("/graph");
  });
});
```

## Coverage targets

For each server action, write tests that cover:

1. **Happy path** — the mutation lands and the right paths are revalidated.
2. **At least one failure path** that the action handles explicitly. If the
   action throws on a constraint violation, assert that. If it no-ops on a
   missing row, assert that too.
3. **View-level invariants** the action relies on. E.g. after
   `setActionNextLetter`, the orphan-cleanup migration `0013` shouldn't leave
   dangling refs — assert by querying `inspection_letters_view` and the
   actions row together.

What you don't need to cover: re-running the same mutation twice (idempotency
is a SQL property, not an action property), every input combination (push that
to schema-level tests), or RLS denial paths from inside an action that runs
with the service role.

## RLS spot-checks

In a separate file (`tests/integration/rls.test.ts`), verify with the **anon**
key that:

- An unauthenticated client cannot select from `inspection_letters`,
  `letter_groups`, `actions`, etc.
- An unauthenticated client cannot insert.

This is a smoke test, not exhaustive. Run after every migration that touches
a `policy` or a new table.

## Anti-patterns

- Mocking the Supabase client. If you find yourself doing this, the test
  belongs in `core.md`'s unit-test layer or it's testing the wrong thing.
- Asserting on the shape of Supabase errors. They change between SDK versions.
  Assert on the post-condition of the DB, not on the error string.
- Reusing IDs across tests. Each test should seed its own storyline / group /
  letter, namespaced so parallel runs don't collide.
