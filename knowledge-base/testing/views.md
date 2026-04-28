# DB view + RLS test patterns

Postgres views generate display IDs that the entire UI treats as truth (per
CLAUDE.md). If a view drifts, every screen lies. These tests run against a
Supabase preview branch — see `server-actions.md` for setup.

## Views to pin

| View | What to assert |
|---|---|
| `inspection_letters_view.content_id` | `L-{storyline.abbr}{group.seq}` for single-letter groups; `L-{abbr}{seq}/{variant}{piece}` for multi-letter groups; suffix hidden when group has one letter; piece omitted when 0 (per migration 0006). |
| `report_segments_view.report_id` | `R-{storyline.abbr}{group.seq}/{variant}`. |
| `report_segments_view.effective_day_id` | Equals **triggering letter's day + 1**. Pin with a setup that places the triggering letter on day 2 and asserts `effective_day_id` resolves to day 3. |
| `sorting_letters_view.content_id` | `S{day_number}-{sort_id zero-padded to 2}`. |
| `playthrough_variables` | 9-column tally + `combined_national` excludes Epicenter. Mirror the unit test on `tallyVariables` at the SQL level so the DB and the app agree. |

## Shape of a view test

```ts
import { describe, it, expect } from "vitest";
import { getTestSupabase, seedStoryline } from "../fixtures/branch";

describe("inspection_letters_view.content_id", () => {
  it("should hide the variant suffix when a group has one letter", async () => {
    const sb = getTestSupabase();
    const { letterId } = await seedStoryline(sb, {
      storylineAbbr: "W2",
      groups: [{ name: "Solo", letters: 1 }],
    });

    const { data } = await sb
      .from("inspection_letters_view")
      .select("content_id")
      .eq("id", letterId)
      .single();

    expect(data?.content_id).toBe("L-W21");
  });

  it("should include /a, /b suffixes when a group has multiple letters", async () => {
    const sb = getTestSupabase();
    const { letterIds } = await seedStoryline(sb, {
      storylineAbbr: "W2",
      groups: [{ name: "Branching", letters: 2 }],
    });

    const { data } = await sb
      .from("inspection_letters_view")
      .select("content_id")
      .in("id", letterIds)
      .order("variant");

    expect(data?.map((r) => r.content_id)).toEqual(["L-W21/a", "L-W21/b"]);
  });
});
```

## When to write one of these

- After **any** migration that creates or alters a view.
- After **any** migration that adds a column the view computes from.
- When app code starts depending on a new view column.

Skip view tests for plain table column adds that no view consumes.

## RLS

Two test files, both small:

```ts
// tests/integration/rls-anon.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

describe("RLS: anon client", () => {
  it.each([
    "storylines",
    "letter_groups",
    "inspection_letters",
    "actions",
    "report_segments",
    "sorting_letters",
    "playthroughs",
  ])("should not allow selecting from %s without a session", async (table) => {
    const { data, error } = await anon.from(table).select("*").limit(1);
    expect(error).toBeTruthy();
    expect(data).toBeFalsy();
  });
});
```

If a future migration relaxes RLS for a public read, update the table list and
add a positive test for the public-read case.

## Anti-patterns

- Asserting on full row contents. Pin the view-computed columns (`content_id`,
  `report_id`, `effective_day_id`); leave the rest to schema migrations.
- Snapshotting the output of `select *`. Tests will fail every time we add a
  column. Project explicitly.
- Coupling view tests to the test-data builder used by action tests. Use
  smaller, view-specific seeds so a view test failure points at the view.
