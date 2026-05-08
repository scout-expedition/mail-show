# Testing inventory

Snapshot of every test file in the repo as of 2026-05-08, what it covers, and how to run it. Updated when test layout or runners change — not when individual cases are added.

## Layers + runners

| Layer | Runner | Scripts | Where it runs |
| --- | --- | --- | --- |
| Unit | `vitest` | `pnpm test`, `pnpm test:watch` | Pure-TS modules, no DB. |
| Integration | `vitest` (via `scripts/test-int.sh`) | `pnpm test:int` | Hits a real Supabase via service-role; covers SQL CHECKs, RLS, views, server actions. |
| E2E | Playwright (via `scripts/test-e2e.sh`) | `pnpm test:e2e` | Full browser; auth-state pre-seeded by `tests/e2e/auth.setup.ts` → `tests/e2e/.auth/storage.json`. |
| All | — | `pnpm test:all` | Runs the three above sequentially. |

E2E expects `SUPABASE_TEST_URL` + `SUPABASE_TEST_SERVICE_KEY` and the dev server reachable at the configured URL. Memory note: the Playwright config requires `allowedDevOrigins=127.0.0.1` in `next.config.ts`, otherwise server-action POSTs silently no-op.

## Unit tests (`pnpm test`)

### Endings — evaluator + analysis
- **`src/lib/endings/evaluator.test.ts`** (~85 cases)
  - `evaluateChip` — text / number_ref / aggregate_ref operators, including class + nation aggregates, ties, missing-input handling.
  - `evaluateRow` — AND across chips, empty-row contract.
  - `evaluateFramework` — text + condition rendering, first-match-wins, nested conditions, AND across chips.
  - `matchingRowsByBlock`, `shadowedRowIds` — pre-shadow vs post-shadow row sets, nested condition scoping, numeric overlap.
  - `evaluateDocument` — text leaves, result leaves, nested condition+result, empty doc, first-match-wins, cycle guard via `evaluatingDocs`.
  - `evaluateChip / aggregate tiebreak resolution` — empty doc → false; doc resolves tied option → true; doc returns null / non-tied → false; nation 3-way tie; "tiebreak only fires on tie" pin.
  - `evaluateFramework` backwards-compat alias parity.
  - `evaluateDocument set-narrowing` — auto-resolve at size 1, gated removals, every-row evaluation, definite result short-circuits, fallback on empty set, `__random_remaining__` rolls the working set, `set_excludes` semantics.
- **`src/lib/endings/static-analysis.test.ts`** (~39 cases)
  - `staticShadowedRows` for text / aggregate / number_ref chips.
  - `uncoveredAssignmentsByBlock` for text + aggregate (including tie-state behavior under empty / non-empty `tiebreakDocsSummary`).
  - `uncoveredAssignmentsByBlock` numeric-interval coverage (open / closed bounds, inequality, multi-chip gaps).
  - `numericRowOverlaps` (partial overlap, full shadow, disjoint, mixed-finite skip).
  - Cap / status edge cases (`cap_exceeded`, `no_finite_vars`), Phase-6 header-variable enumeration, per-block scoping, determinism.
- **`src/lib/endings/color-palette.test.ts`** — palette index → color mapping; `colorIndexFor` is deterministic.

### Endings — server actions
- **`src/app/(authed)/endings/_shared/document-actions.test.ts`** (~31 cases)
  - `createFrameworkDocument`, `renameDocument`, `deleteFrameworkDocument` — happy path + kind-aware rejections.
  - `addBlock` — text / condition / result / fallback type validation, `result_value` validation per doc kind (framework_selection UUID lookup, class/nation option set, framework rejection).
  - Rows + chips + header variables (CRUD shape).
  - Deletes (block / row / chip / header var).
  - `saveDocument` — UPDATE-only invariant, revalidate calls.
- **`src/app/(authed)/endings/variables/actions.test.ts`** (4 cases)
  - `createEndingVariable` — names "New variable", auto-suffix on collision, ignores number_ref sort_order slots.
  - `createEndingVariableValue` — rejected on number_ref, accepted on text.
  - **Gap**: no coverage yet for `createEndingVariableInline`, `createEndingVariableValueInline`, or `updateAllEndingVariables` (color_hex validation specifically).

### Other domains
- **`src/lib/rules/evaluate.test.ts`** — sorting-rules evaluator (Phase 3 sim): operators (equals / contains / numeric / is-with-reference_type), target_slice scoping, `evaluateRule` composition.
- **`src/lib/playthrough/variables.test.ts`** — `tallyVariables` impact aggregation, `combined_national` logic.
- **`src/lib/citizen-id.test.ts`** — `formatCitizenIdInput`, `isValidCitizenId`, `generateRandomCitizenId`.
- **`src/lib/color.test.ts`** — `normalizeHex` corner cases.
- **`src/lib/ids.test.ts`** — display-id formatters: `formatInspectionLetterId` (L-W2/b3 with omitted variant/piece), `formatReportId`, `formatSortingLetterId`, `formatRfidPayload`, `randomLetterId`.
- **`src/lib/letter-groups.test.ts`** — `groupSlug` / `parseGroupSlug` round-trip.
- **`src/lib/graph-overlay.test.ts`** — `extractActiveImpacts` overlay computation.
- **`src/lib/db/enums.test.ts`** — random sentinels, `parseRandomSubset` / `formatRandomSubset` parsers.
- **`src/lib/utils.test.ts`** — `lpad`, `formatSortId`, `parseDurationToSeconds`, `formatDurationMMSS`, `toRoman`.

### Inspection letters
- **`src/app/(authed)/inspection/letters/actions.test.ts`** (12 cases) — `moveLetterGroupToDay`, `moveLetterToGroup`, `saveGroup`, `moveReportSegmentToDay` (drag + drop server actions for the narrative graph + workspace).

## Integration tests (`pnpm test:int`)

Each spins up a service-role Supabase client and exercises real Postgres.

- **`tests/integration/endings_logic_v2_constraints.test.ts`** (~30 cases) — `ending_documents` kind + name CHECKs, singleton partial unique, framework name uniqueness; `ending_blocks` block_type CHECK matrix (text / condition / result + fallback shape), parent_block / parent_row co-presence, valid nesting; `ending_condition_row_chips` operator + value-shape constraints; `ending_variables.aggregate_ref` allowed-set + kind/shape rules.
  - **Gap**: no positive case yet for `nation_tiebreak_set` aggregate_ref, no coverage for the 0029 `color_hex` regex CHECK.
- **`tests/integration/rls.test.ts`** (4 cases) — anon client cannot read or insert into protected tables (`letter_groups`, `ending_condition_rows`, `ending_condition_row_chips`); service-role sanity check.
- **`tests/integration/views/inspection-letters-view.test.ts`** (5 cases) — `inspection_letters_view.content_id` formatting (single-letter group hides variant suffix, piece omitted at 0, multi-piece formatting).
- **`tests/integration/views/report-segments-view.test.ts`** (4 cases) — `report_id` + `effective_day_id` derivation rules.
- **`tests/integration/views/sorting-letters-view.test.ts`** (2 cases) — `sorting_letters_view.content_id`.
- **`tests/integration/views/playthrough-variables.test.ts`** (3 cases) — 9-column impact tally + `combined_national` (excludes Epicenter by design).

## E2E tests (`pnpm test:e2e`)

- **`tests/e2e/smoke.spec.ts`** (1 active) — unauthenticated `/` → redirect to `/sign-in`. Drops `storageState` so it tests the proxy bounce specifically.
- **`tests/e2e/dashboard.spec.ts`** (1 active) — authed user loads `/dashboard` without bouncing. Validates the storageState wiring written by `auth.setup.ts`.
- **`tests/e2e/endings-frameworks.spec.ts`** (4 cases, **all `test.skip`**) — original v3 frameworks editor flow. Skipped pending the Step 6 rewrite for the unified `ending_documents` schema (see `docs/endings-logic-v2-plan.md`). Restoring this file means rewriting against the new shape, not flipping `.skip` off — the seed hooks still reference dropped tables.

## Notable gaps

(See `docs/endings-logic-v2-plan.md` for context on the open work; these are concrete follow-ups specifically about test coverage.)

- **0029 `color_hex` CHECK**: no test rejects malformed hex strings (`#abc`, `red`, `#GG0000`) or accepts a valid `#RRGGBB`.
- **Nation Tiebreak Set positive case**: existing aggregate_ref test rejects unknown values but doesn't pin `nation_tiebreak_set` as accepted.
- **`evaluateDocumentDetailed`**: narrowing path's deferred-roll contract (rollPool = working-set snapshot, rollSentinel set) is not asserted directly. Today's narrowing tests only call `evaluateDocument`, which rolls eagerly, so the "preview gets the unrolled pool" path is untested.
- **`resolveAggregatesDetailed` from narrowing-path random**: the framework preview's nation-tiebreak reroll button is wired through `fromRandom` + `rollPool` plumbing in `resolveTieInline`. No test pins this for the narrowing branch.
- **Inline-create server actions**: `createEndingVariableInline` (variable + first value + default) and `createEndingVariableValueInline` (append value to text variable; reject on number_ref / aggregate_ref) — no coverage.
- **`updateAllEndingVariables` color_hex**: validates `#RRGGBB` format and persists; no test.
- **Step 6 — endings E2E rewrite**: the skipped spec needs to be rebuilt for the unified shape (3 logic tabs, persistence, tiebreak resolution end-to-end via framework preview, fallback flows on each fallback-bearing doc).
