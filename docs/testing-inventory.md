# Testing inventory

Snapshot of the test layout — layer × runner × scope. Per-case detail is **not**
maintained here; CI coverage is the count-of-record (see "Coverage ratchet"
below). Updated when test layout, runners, or floors change — not when individual
cases are added.

## Layers + runners

| Layer | Runner | Scripts | Scope | Files |
| --- | --- | --- | --- | --- |
| Unit | `vitest run` | `pnpm test`, `pnpm test:watch` | Pure-TS modules in `src/lib/**` + colocated component tests. No DB, no network. | `src/**/*.test.ts(x)` (excluding `src/app/**/*actions.test.ts`) |
| Integration | `vitest run --config vitest.integration.config.ts` (via `scripts/test-int.sh`) | `pnpm test:int` | Server actions, DB views, RLS, SQL CHECKs. Service-role client against a local Supabase. Files run serially (`fileParallelism: false`) and share one client. | `tests/integration/**/*.test.ts`, `src/app/**/*actions.test.ts` |
| E2E | Playwright (via `scripts/test-e2e.sh`) | `pnpm test:e2e` | Browser-level golden paths. Auth state pre-seeded by `tests/e2e/auth.setup.ts` → `tests/e2e/.auth/storage.json`; the `chromium` project consumes it via `storageState`. | `tests/e2e/**/*.spec.ts` |
| All | — | `pnpm test:all` | Runs the three above sequentially. | — |

**CI** — `.github/workflows/ci.yml` runs all three layers on every PR and on
pushes to `main`. The `check` job does typecheck + lint + unit + coverage; a
combined `integration-e2e` job boots a local Supabase stack
(`supabase start`) and runs the DB-backed layers + coverage. Node version is
pinned in `.nvmrc` (24 — the integration suite needs native `WebSocket`, Node 22+).
All three layers are blocking gates (no `continue-on-error`). `pnpm lint`
runs `eslint --max-warnings 0` so a fresh warning is enough to fail the
build, not just a fresh error.

**Env requirements** — integration + E2E need `SUPABASE_TEST_URL`,
`SUPABASE_TEST_SERVICE_KEY`, `SUPABASE_TEST_ANON_KEY` exported (CI writes them
to `$GITHUB_ENV` from `supabase status -o json`; local dev uses
`.env.test.local`). Playwright additionally requires
`next.config.ts → allowedDevOrigins: ["127.0.0.1"]` so server-action POSTs
aren't silently dropped.

## What lives where

- **`src/lib/**` pure modules** → unit. Anything no-DB, no-network with real
  branching logic ships with a colocated `*.test.ts`.
- **`src/app/**/actions.ts` server actions** → integration. `next/cache` +
  `next/navigation` + `@/lib/supabase/server` are mocked; the action is
  invoked, the DB mutation is asserted directly via `makeTestClient()`, and
  the exact `revalidatePath` calls are asserted on the spy. For `patch*`-style
  instant-save actions that intentionally do not revalidate (realtime fans out
  the change), assert the no-op contract.
- **`tests/integration/views/**`** → integration. Postgres view derivations
  (content IDs, effective day IDs, variable tallies).
- **`tests/integration/rls.test.ts`** → integration. Anon client must be
  blocked from protected tables.
- **`tests/integration/endings_logic_v2_constraints.test.ts`** → integration.
  Block / row / chip CHECKs + aggregate_ref shape rules.
- **`tests/e2e/**`** → E2E. Two golden paths (inspection-letters slide,
  narrative-graph drag) + the smoke / dashboard / auth-users specs.

## Coverage ratchet

`pnpm test --coverage` and `pnpm test:int --coverage` both enforce regression
thresholds defined in `vitest.config.ts` / `vitest.integration.config.ts`.
Thresholds are set **slightly below** the measured baseline — the goal is "don't
get worse", not "hit a target". When coverage rises meaningfully, raise the
floor in the same PR. Per-glob floors pin the well-tested subdirectories so a
global average can't mask a regression there.

Provider is `@vitest/coverage-v8`. HTML reports land in `coverage/` (unit) and
`coverage-int/` (integration); CI uploads both as artifacts. To inspect a
threshold breach in CI, open the run page → Artifacts → download
`coverage-unit` or `coverage-int` and open `index.html`.

| Run | Baseline (stmts / branches / fns / lines) | Floor (stmts / branches / fns / lines) |
| --- | --- | --- |
| Unit (`src/lib/**`) | 61.46 / 56.72 / 54.92 / 62.9 | 60 / 55 / 53 / 60 |
| Integration (`src/app/**/actions.ts`) | 59.25 / 49.94 / 60.62 / 64.13 | 57 / 47 / 58 / 62 |

**Per-glob floors (unit)** — set just below the well-covered subdirectories so
they can't regress quietly. Baselines shown so future reviewers can see the
headroom at a glance:

| Glob | Baseline (stmts / branches / fns / lines) | Floor (stmts / branches / fns / lines) |
| --- | --- | --- |
| `src/lib/rules/**` | 91.93 / 90.62 / 100 / 100 | 88 / 85 / 95 / 95 |
| `src/lib/endings/**` | 84.53 / 75.82 / 93.93 / 89 | 80 / 72 / 90 / 85 |
| `src/lib/db/**` | 87.65 / 77.77 / 71.42 / 90 | 85 / 75 / 70 / 85 |
| `src/lib/auth/**` | 95.94 / 92.59 / 100 / 100 | 90 / 80 / 95 / 95 |

`src/lib/db/**` functions has the tightest margin (71.42 → 70) because
`enums.ts` carries one untested helper and `days.ts` is a tiny barrel; the
other lib subdirs have 4–8 points of headroom.

Integration thresholds are global only — two files (`auth/set-password/actions.ts`,
`sign-in/actions.ts`) sit at 0% (would need a GoTrue session harness), and the
giant `inspection/letters/actions.ts` is 13.5% (core flows covered, long tail
not). Pinning per-file would either get circumvented or be aspirational.

## What we deliberately don't unit-test

- **`src/lib/realtime/*`** — `presence.ts`, `channel.ts`, `avatar-stack.tsx`,
  `use-flash.ts`, `use-shared-view-state.ts`, `use-instant-field.ts` are thin
  wrappers around Supabase realtime + React effects. Testing them in isolation
  exercises framework internals, not our logic; the contracts they enforce
  (presence sync, autosave debounce + revalidate) are validated end-to-end via
  the integration + E2E layers.
- **`src/lib/supabase/{server,client,middleware}.ts`** — client constructors.
  All branches are "did the cookie helper get wired" — exercised implicitly
  every time the integration / E2E suite runs.
- **`src/lib/local-storage.ts`** — pure SSR-safe shims; covered via the hooks
  that consume them.
- **Trivial barrels** — e.g. `endings/frameworks/actions.ts` is a single
  re-export.

These show up as 0% in the unit-coverage report on purpose; the floors are
calibrated to account for them.

## Burndown — done

Both items that were advisory in CI are now blocking gates. Kept the
section for the historical narrative on how each cleared.

- **Lint** — cleared in PR #74. 61 problems (26 errors + 35 warnings) →
  0 under `eslint --max-warnings 0`. Mix of mechanical unused-imports,
  React 19 `react-hooks/refs` (assignments during render → wrapped in
  `useLayoutEffect`), `react-hooks/set-state-in-effect` (prop→state
  mirrors → adjust-state-in-render pattern; legitimate external-system
  effects → targeted disable + justification). `--max-warnings 0` locks
  the cleanup in so warnings can't accumulate again.
- **E2E settings management** — cleared in PR #75. Cause was *not* a
  `/settings` listing bug: the per-user actions had been refactored from
  flat buttons (`Delete` / `Send reset link` / `Send magic link` per
  row) into an `<OverflowMenu>` dropdown (`More actions` button →
  `role="menuitem"` items), and the three failing specs still targeted
  the old flat-button selectors. Updated to open the menu first and
  click the `menuitem` by name. The "self-delete is blocked" spec was
  also updated for correctness — it was checking the absence of a flat
  Delete button (which never exists anymore), now checks the absence of
  the `Delete user` menuitem in the own row's menu.

## Deferred / blocked

- **`tests/e2e/endings-frameworks.spec.ts`** is fully `test.skip` pending the
  Step 6 rewrite for the unified `ending_documents` schema (see
  `docs/plans/active/endings-logic-v2-plan.md`). The seed hooks still reference dropped
  tables; restoring it means a rewrite, not flipping `.skip` off.
- **Playthrough runtime tests** — the playthrough framework that consumes
  `evaluateEnding` isn't built yet; nothing to test end-to-end yet.
- **`updateAllEndingVariables` color_hex (server-action level)** — the action
  validates `#RRGGBB` and persists. The DB-level CHECK is covered by the
  integration suite; the server-action wrapper isn't pinned end-to-end.
