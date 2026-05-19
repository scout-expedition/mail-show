# Test suite remediation plan

Closes the gaps between `docs/testing-protocol.md` and the actual suite. Audit
found the framework had drifted from its own stated policy: no CI to enforce a
green suite, integration-DB docs describing infrastructure that didn't exist,
server actions barely tested despite an "always test" policy, both named
golden-path E2Es missing, and pure logic (`block-state.ts`) untested.

Sequenced so enforcement lands first (nothing written later rots), then cheap
pure-logic wins, then the bulk integration debt, then E2E. Each phase is an
independently shippable PR. One-developer team — "high signal, low maintenance".

## Phases

- **Phase 0 — CI foundation + docs reconciliation.** ✅ **Done** (see status log).
- **Phase 1 — Cheap pure-logic wins.** `src/lib/endings/block-state.test.ts` (7
  pure fns); audit `evaluate.test.ts` for full `VALID_OPERATOR_REFERENCES` matrix
  iteration; `assign-avatar` / `profile` if they have real branching.
- **Phase 2 — Server actions, Batch A.** `sorting/rules`, `inspection/storylines`,
  the storyline-groups + sorting-letters reorder actions. Reference template:
  `inspection/letters/actions.test.ts`. Extend `tests/integration/_helpers.ts`.
- **Phase 3 — Server actions, Batches B–D.** Remaining `actions.ts` files; close
  the `updateAllEndingVariables` color_hex gap.
- **Phase 4 — Golden-path E2E.** `tests/e2e/_helpers.ts`, `inspection-letters.spec.ts`
  (5-panel slide edit/save/reload), `narrative-graph.spec.ts` (drag group to a day).
- **Phase 5 — Coverage ratchet + inventory refresh.** Add `@vitest/coverage-v8`,
  baseline coverage, add below-baseline thresholds to `vitest.config.ts`; refresh
  `docs/testing-inventory.md`.
- **Phase 6 — Deferred/blocked.** `endings-frameworks.spec.ts` rewrite (blocked on
  `endings-logic-v2-plan.md` Step 6); "deliberately not unit-tested" note for thin
  hooks.

## Status log

### Phase 0 — done (2026-05-19)

CI now runs all three test layers on every PR and on pushes to `main`.

**Shipped:**
- `.github/workflows/ci.yml` — `check` job (typecheck · lint · unit) +
  combined `integration-e2e` job that boots a local Supabase stack
  (`supabase start`), exports keys via `$GITHUB_ENV`, runs `pnpm test:int`,
  `pnpm build`, then `pnpm test:e2e`.
- `playwright.config.ts` — `webServer` uses prebuilt `next start` under CI
  (steadier than on-demand `next dev`).
- `scripts/test-int.sh` / `test-e2e.sh` — `.env.test.local` is now optional
  when the `SUPABASE_TEST_*` vars are already exported (the CI path).
- `.nvmrc` (Node 24). The integration suite needs native `WebSocket`
  (`@supabase/realtime-js`), i.e. Node 22+; the repo previously pinned nothing.
- Docs reconciled to the real local-stack DB strategy: `testing-protocol.md`,
  `vitest.integration.config.ts`, `tests/integration/README.md`, `CLAUDE.md`
  (+ a new timestamp-based migration-naming convention).

**Blockers found & fixed during execution:**
- **Migration prefix collision.** Five duplicate numeric prefixes (`0034`–`0038`)
  broke `supabase db reset` / `supabase start` (the CLI keys migrations by their
  numeric `version`). The order-independent file of each pair was given a
  timestamp prefix (`20260519181501`–`…505`) — the collision-proof format the
  Supabase CLI generates for new migrations, and what dodged a fresh collision
  with `main`'s `0040_updated_by_delete_attribution`. `supabase db reset` now
  applies every migration cleanly; convention documented in `CLAUDE.md`.
- **Two stale integration tests** (pre-existing rot, no CI to catch them):
  `report-segments-view` asserted pre-`0036` view behaviour — rewritten to the
  triggering-letter rule (`addAction` helper extended with `reportSegmentId`);
  `addRow` sort_order test assumed a 0-based base — corrected to 1-based.
  Integration suite now 135/135; unit 430/430; typecheck clean; build clean.

**Advisory in CI — burndown pending (see `docs/testing-inventory.md`):**
- `pnpm lint` — ~49 pre-existing errors (mostly `react-hooks/*` rules from the
  Next 16 upgrade). Runs `continue-on-error`.
- `tests/e2e/auth-users.spec.ts` — 3 failing settings-management specs (a user
  created via the admin API never appears in the `/settings` list). E2E step
  runs `continue-on-error`.
- Both flip to blocking once the debt is cleared.
