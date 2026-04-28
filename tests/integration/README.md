# Integration tests

Integration tests in this repo run **server actions against a real Supabase
instance**. They live next to source as `*.test.ts` (when colocated with
actions) or under `tests/integration/`.

Run with:

```sh
pnpm test:int
```

The runner refuses to start without two env vars set:

- `SUPABASE_TEST_URL` — API URL of the test Supabase instance.
- `SUPABASE_TEST_SERVICE_KEY` — service-role / "Secret" key for that instance (bypasses RLS).
- `SUPABASE_TEST_ANON_KEY` — publishable / anon key (only required by `rls.test.ts`).

It also refuses to start if `SUPABASE_TEST_URL` matches `NEXT_PUBLIC_SUPABASE_URL`
(belt-and-braces against pointing at the dev project).

## Two ways to provide a test instance

### Option A — Local Supabase stack (recommended)

One-time setup:

```sh
# from repo root
supabase init                # creates supabase/config.toml if missing
supabase start               # boots Postgres + GoTrue + PostgREST in Docker
```

`supabase start` prints `API URL` and `service_role key`. Drop them in
`.env.test.local` (gitignored):

```
SUPABASE_TEST_URL=http://127.0.0.1:54321
SUPABASE_TEST_SERVICE_KEY=sb_secret_...        # "Secret" from supabase start
SUPABASE_TEST_ANON_KEY=sb_publishable_...      # "Publishable" (RLS tests only)
```

Apply migrations (re-run after every new migration):

```sh
supabase db reset            # nukes the local db and re-applies all migrations + seed.sql
```

Then:

```sh
pnpm test:int
```

To stop the stack: `supabase stop`. Data is preserved across stops; use
`supabase db reset` to start clean.

### Option B — Supabase preview branch

Provision via the dashboard (Branches → Create) or the Supabase MCP. Copy the
branch's API URL + service-role key into `.env.test.local`. Branches require
a paid plan and ~30-60s to provision, so they're better for CI than for the
inner dev loop.

## How tests stay isolated

The harness in `_helpers.ts`:

- Prefixes seeded storyline names + day notes with `__INT_TEST__`.
- `seedStoryline()` creates one storyline (abbreviation `T`) + N days + one
  letter group on each test invocation.
- `cleanupTestData()` runs in `beforeAll` and `afterEach`, deleting every row
  with the test prefix. Foreign-key cascades take care of report groups,
  letters, actions, etc.

`abbreviation = 'T'` is a char(1) unique slot, so only one test storyline can
exist at a time — which is why we run `pnpm test:int` with `fileParallelism:
false` (set in `vitest.integration.config.ts`).

## Loading env

`pnpm test:int` runs `scripts/test-int.sh`, which sources `.env.test.local`
before invoking Vitest. No need to export vars manually. Vitest args forward,
so:

```sh
pnpm test:int                       # run everything
pnpm test:int -t "should clear"     # single test
pnpm test:int --watch               # watch mode
```

If `.env.test.local` is missing, the script prints setup instructions and
exits non-zero.

## What goes here vs. in unit tests

See `docs/testing-protocol.md` and `knowledge-base/testing/server-actions.md`.
The short version: anything that depends on a live DB, RLS, or a Postgres
view goes here. Pure logic goes in unit tests.
