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

### Phase 1 — done (2026-05-19)

Pure-logic unit tests; PR #60.

- `src/lib/endings/block-state.test.ts` — all 7 indexers.
- `src/lib/rules/evaluate.test.ts` — an exhaustive `VALID_OPERATOR_REFERENCES`
  matrix walk (per-pair expected result + a completeness check).
- `src/lib/auth/profile.test.ts`, `src/lib/auth/assign-avatar.test.ts`.
- Builders added to `tests/fixtures/builders.ts`.

**Bug found & fixed:** the strengthened matrix walk caught a live routing
bug — `is` + `any_number` conditions always evaluated `false` because
`evaluate.ts` keyed the digit-check to `number` while the UI matrix pairs
`is` with `any_number`. Fixed in the same PR.

### Phase 2 — done (2026-05-19)

Server-action integration tests, Batch A (the riskiest untested mutations).
~85 new tests; integration suite 220/220.

- `sorting/rules/actions.test.ts` — letter allocation, `duplicateRule`
  deep-clone, the "no free letter" throw, `saveRuleAll` / `saveConditions`
  delete-then-reinsert, the `patchSortingRule` no-revalidate contract.
- `inspection/storylines/actions.test.ts` — 11 actions: reserved-`D`
  abbreviation guard, `reorderStorylines` cascade, the `updateLetterGroup`
  report-group name mirror.
- `inspection/storylines/[id]/groups/[groupId]/actions.test.ts` — 9 actions
  (inspection-letter / action / report-segment CRUD).
- `sorting/letters/actions.test.ts` — sorting-letter CRUD + `patchSortingLetter`.
- `tests/integration/_helpers.ts` — `addRule` / `addRuleCondition` /
  `cleanupSortingRules` builders.
- `knowledge-base/testing/server-actions.md` rewritten — it still described
  the non-existent "preview branch" harness; now matches the real
  `_helpers.ts` / `makeTestClient` pattern.

### Phase 3 — done (2026-05-19)

Server-action integration tests, Batches B–D. ~110 new tests; integration
suite **329/329**.

- New test files (9): `inspection/actions`, `top-of-day/morning-reports`,
  `days`, `playthroughs`, `citizens`, `cities`, `nations`, `physical`,
  `settings`. (`endings/frameworks/actions.ts` is a pure re-export of
  `_shared/document-actions.ts`, already covered by
  `document-actions.test.ts` — skipped.)
- `tests/integration/_helpers.ts` — six new builders + cleanups:
  `addNation`, `addCity`, `addCitizen`, `cleanupReferenceData`,
  `addActionTemplate`, `cleanupActionTemplates`, `addGenericReportBlock`,
  `addPhysicalLetter`, `cleanupPhysicalLetters`. `cleanupReferenceData`
  wipes all citizens / cities (action-created rows carry no test marker)
  and preserves the 5 seeded production nations.

**Bugs found & fixed (surfaced by the new tests):**
- `updateDay` wrote `name: nilStr(formData.get("name"))` to a `days.name`
  column that doesn't exist — every save would 500 via PostgREST. Payload
  key dropped.
- `updateAllNations` wrote `icon_type` / `icon_value` to columns that
  don't exist on `nations` (the same bug shape). Payload keys dropped;
  `patchNation` still accepts them in its shape so the existing UI binding
  type-checks, but strips them before the DB write (a proper migration to
  give nations icon columns is the right long-term fix; tracked as
  follow-up).

**Migration-collision note.** Two new `0040_*` migrations had landed on
`main` after Phase 0 (`0040_citizen_structured_name.sql`,
`0040_letter_group_sort_order.sql`) — `supabase db reset` errored on the
duplicate prefix. Fixed independently in PR #67 (renamed both to
timestamp prefixes per the `CLAUDE.md` convention); my Phase 3 branch
rebased onto that fix.

### Phase 4 — done (2026-05-19)

Golden-path E2E specs for the two surfaces `testing-protocol.md` names
("inspection letters: edit + save + reload" and "narrative graph: drag a
letter group to a new day"). Both pass locally on a clean stack.

- `tests/e2e/_helpers.ts` (new) — `makeAdmin()` + `e2eName()` +
  `cleanupE2EData()`, mirroring `tests/integration/_helpers.ts` but with a
  `__E2E__` prefix so the two layers' data can coexist in the local stack.
- `tests/e2e/inspection-letters.spec.ts` (new) — deep-links via
  `?letter=Z1-a` (sidesteps the 5-panel slide-advance), edits the Summary
  field through `useInstantField`'s autosave, asserts DB persistence and a
  reload re-fetch.
- `tests/e2e/narrative-graph.spec.ts` (new) — pre-sets
  `localStorage["graph.editingEnabled"]` via `addInitScript`, drags the
  letter-group node via xyflow's `.group-drag-handle` from one day-row band
  to another, asserts `letter_groups.delivery_day_id` flipped in the DB
  and survives a reload.

E2E selectors prefer ARIA roles / `data-testid`s xyflow already exposes
over Tailwind class names — same "stable handles" rule
`knowledge-base/testing/e2e.md` calls out.
