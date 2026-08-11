# Sorting Letters workspace plan

Status: draft (not started)
Branch: `sorting-letters`

Rework `/sorting/letters` from an inline-editable table into a view-only sortable
table plus a side editor panel, flip the stamp semantics in the database, show a
computed destination slot per letter, add bulk operations, and add a letter
generator that fills sender/recipient from the citizen directory so the letter
sorts to a chosen rule.

## Decisions taken (confirmed with the user)

1. **Stamp semantics move into the database.** `sorting_letters.is_counterfeit`
   is renamed to `stamp_valid` with values inverted (`true` = valid stamp,
   `false` = fake). The `rule_target` enum value is renamed to match.
2. **The `/sorting/letters/[id]` page is replaced by the panel.** The route stays
   as a redirect to `/sorting/letters?letter=<id>` so existing links keep working.
3. **Destination conflicts:** among the rules active on the letter's day, the one
   with the highest `day_implemented` day number wins. A tie on the same
   implemented day renders a warning instead of a slot. No match renders a dash.
4. **Generator strictness:** at generation time the letter must match the target
   rule and must not be captured by a higher-precedence active rule. The
   intention is not persisted — later rule edits may re-route the letter, and
   that is fine.

## Assumptions (flagged, not confirmed)

- **"Clear day" is dropped from the bulk actions** (user decision). `day_id`
  stays `not null`: a sorting letter always belongs to a day, so `content_id`
  is never ambiguous and `unique (day_id, sort_id)` keeps its meaning. The bulk
  menu offers "Set delivery day" with no clear.
- **Rules with no `day_implemented_id` rank at 0** — active from the first day,
  below every dated rule (a real day-1 rule ranks 1 and wins the tie).
- **A rule stops applying on its `day_cancelled` day** (cancellation is
  inclusive of the cancelling day: active while `implemented <= day < cancelled`).
  A rule whose cancelled day precedes its implemented day is never active.
  Missing/deleted day references degrade to undated / uncancelled.
- The panel picks citizens with a plain `<Select>` over the directory rather than
  extracting the `HeroSearch` combobox out of `inspection/letters/workspace.tsx`.
  Upgrade path noted with a `ponytail:` comment if the directory outgrows it.

## Phase 1 — Stamp semantics flip (DB + code)

**1a. Migration** (`supabase migration new sorting_letter_stamp_valid`):

- Column + data, guarded so a re-run is a no-op (`information_schema.columns`
  shows `is_counterfeit` present and `stamp_valid` absent):
  - flip existing stamp rule conditions **first**, while the target is still
    named `is_counterfeit`, so `is`/`is_not true|false` keeps its meaning:
    `update public.sorting_rule_conditions set reference_type = case reference_type when 'true' then 'false' else 'true' end where target = 'is_counterfeit' and reference_type in ('true','false');`
  - `update public.sorting_letters set is_counterfeit = not is_counterfeit;`
  - `alter table public.sorting_letters rename column is_counterfeit to stamp_valid;`
- Enum rename in its own guard — `alter type ... rename value` has no
  `if exists`, so check `pg_enum` for the old label first:
  `alter type public.rule_target rename value 'is_counterfeit' to 'stamp_valid';`
- `drop view if exists public.sorting_letters_view;` then recreate it (the view
  selects `sl.*`, and `create or replace view` cannot rename a view column).
  **Re-grant afterwards** — `drop view` takes the grants with it:
  `grant select on public.sorting_letters_view to authenticated, service_role;`
- No policy or other view references the column (verified by grep over
  `supabase/`); RLS on `sorting_letters` is blanket table-level.

**1b. Code renames** (mechanical, compiler-guided):

- `src/lib/db/types.ts` — `is_counterfeit` → `stamp_valid`.
- `src/lib/db/enums.ts` — `RULE_TARGETS` value, `RULE_TARGET_LABELS` ("Stamp"),
  `targetKind` (`counterfeit` → `stamp`), `BOOLEAN_TARGETS`.
- `src/lib/rules/evaluate.ts` — `RuleContext.stamp_valid`, the `asTargetValue`
  branch.
- `src/lib/rules/normalize.ts`, `src/lib/rules/condition-target.ts` — kind and
  subject rename; subject label "Counterfeit stamp" → "Stamp".
- `src/app/(authed)/sorting/rules/conditions-editor.tsx` — the stamp subject's
  `true`/`false` reference options read **valid** / **fake**.
- `src/app/(authed)/days/[identifier]/sorting/page.tsx` — badge shows
  `fake stamp` when `!stamp_valid`.
- Presence focus keys rename with the column (`makeFocusKey("stamp_valid")`), so
  two clients don't highlight a field name that no longer exists.
- Tests: `src/lib/rules/evaluate.test.ts` (cover `is_not true` and `is_not false`,
  not just `is`), `sorting/rules/actions.test.ts`, `sorting/letters/actions.test.ts`.

**Verify:** `pnpm typecheck`, `pnpm test`, and `supabase db reset` against the
local stack.

## Phase 2 — Destination resolver

New pure module `src/lib/rules/destination.ts` (+ `destination.test.ts`):

- `buildRuleContext(letter, { citizens, cities, nations, day })` → `RuleContext`.
  Name parts come from the linked citizen when `sender_citizen_id` /
  `recipient_citizen_id` is set, otherwise from `splitName()` over the
  denormalized `*_name` (middle name null in that case). City/nation names
  resolve from the id columns, falling back to the denormalized text columns.
- `activeRules(rules, days, dayNumber)` → rules where
  `implementedRank <= dayNumber < cancelledNumber`. `implementedRank` is the
  implemented day's `number`, or `0` when undated (so it never ties with a real
  day-1 rule). Missing cancelled day = uncancelled; cancelled before
  implemented = never active.
- `resolveDestination(rules, conditionsByRule, ctx, dayNumber)` →
  ```
  | { status: "none" }                              // nothing matched
  | { status: "unassigned"; rule }                  // matched, but the rule has
                                                    // no slot and no reporting
  | { status: "resolved"; rule; slot; routesToReporting }
  | { status: "conflict"; rules }                   // equal rank, different dests
  ```
  Winner = highest `implementedRank` among matches. Equal rank pointing at the
  **same** destination is not a conflict (it resolves); equal rank pointing at
  different destinations is. `unassigned` renders as a muted dash with a title,
  never as a successful match.

Used by the table's Destination column, the panel readout, and the generator's
winner check — one implementation, three call sites. The generator additionally
requires a *unique* top-rank match, since a same-destination tie doesn't tell it
which rule it satisfied.

## Phase 3 — Table + side panel

`src/app/(authed)/sorting/letters/`:

- **`sorting-letters-editor.tsx`** — becomes the two-pane workspace (same shape as
  `sorting/rules/rules-list.tsx`): table left, panel right, `?letter=<id>` deep
  link kept in sync via `router.replace`.
- **Table** is view-only text except the Stamp toggle. Columns: ID, Day,
  Recipient, Sender, **Stamp** (toggle button switching valid ⇄ fake, styled off
  the existing badge/pill vocabulary), **Destination** (slot pill, reporting pill,
  dash, or warning icon on conflict with both rule letters in the title),
  Storage, kebab.
- **Sorting**: clicking a column heading cycles asc → desc; `aria-sort` on the
  active header; local `useState`, no dependency. Default stays day then sort_id.
- **Row click** selects the letter and opens the panel; per-row **kebab** reuses
  `OverflowMenu` from `@/components/panel` with Edit / Delete (confirm via
  `useConfirm`). The pencil + X buttons are removed.
- **`letter-panel.tsx`** (new) — instant-save editor using the existing
  `useInstantField` + `patchSortingLetter` + `FieldHighlight` presence plumbing:
  day, sort id, storage, stamp toggle, recipient/sender blocks (citizen select
  that autofills name / citizen # / city / nation, plus the manual fields),
  notes, and a read-only destination readout.
- **`[id]/page.tsx`** — replaced by
  `redirect('/sorting/letters?letter=' + encodeURIComponent(id))`. The workspace
  drops the param when no such letter exists rather than 404ing.
- `updateSortingLetter` (whole-form action) is deleted with the page; the panel
  patches per field.
- **Realtime:** an UPDATE that changes `day_id` or `sort_id` invalidates the
  view-derived `content_id` / `day_number`, which can't be recomputed client
  side — those changes schedule a `router.refresh()` like INSERTs already do.
  Other column updates keep merging in place.

## Phase 4 — Bulk mode

- A "Select" toggle in the table header switches on a checkbox column plus a
  select-all box; a sticky action bar shows the selection count and the actions.
- Actions (all in `actions.ts`). Anything that moves, creates, or deletes a
  letter revalidates `/sorting/letters`, `/physical`, and
  `/days/[identifier]/sorting` (as a `"page"`-type path, since the segment is
  dynamic); field-only patches revalidate `/sorting/letters` alone:
  - `bulkPatchSortingLetters(ids, patch)` — backs **clear storage / sender /
    recipient / notes / all**, and **set stamp validity / storage / notes /
    sender / recipient**. Clearing is the same call with nulls.
  - `bulkSetSortingLetterDay(ids, dayId)` — moves letters, re-assigning
    `sort_id` to the lowest free slot in the target day on collision. There is
    no "clear day": `day_id` stays `not null`.
  - `renumberSortingLetters(dayId)` — compacts `sort_id` within a day to
    `0..n-1` in current order. Two-pass through a temporary offset to dodge the
    `unique (day_id, sort_id)` constraint.
  - `bulkDeleteSortingLetters(ids)` — behind `useConfirm`.
  - `bulkApplyRuleToLetters(ids, ruleId)` — only enabled when every selected
    letter shares a day; the confirm dialog states plainly that it rewrites
    sender and recipient. Reuses the Phase 5 sampler.
- Integration tests in `actions.test.ts` for day-move re-ID, renumber, and the
  rule-apply path.

## Phase 5 — Generator

- **Trigger:** a "Generate" button in the table header opens a dialog: day,
  rule (only rules active on that day), count.
- **`generateSortingLetters({ dayId, ruleId, count })`** in `actions.ts`:
  1. Load citizens + cities + nations, all rules + conditions, and the day's
     existing letters (taken `sort_id`s and citizens already used that day).
  2. **Check capacity before sampling:** free slots = `100 - taken.length`. If
     `count > freeSlots`, cap and report it rather than discovering it mid-loop.
  3. For each letter: take the lowest free `sort_id`; pick a sender/recipient
     pair + stamp value (below), preferring citizens unused that day.
  4. Insert the winners with both the citizen FKs and the denormalized
     name / citizen # / city / nation columns filled. Insert one row at a time
     and retry a `23505` unique violation with a recomputed slot (up to 3 times)
     — the Supabase client has no transaction, so a concurrent generate is the
     realistic race. `ponytail:` comment marks the RPC upgrade path.
  5. Return `{ created, requested, reason? }`; the client toasts a shortfall
     ("generated 4 of 10 — no citizen pair satisfies rule C").
- **Candidate selection is domain-driven, not blind rejection sampling** — pure
  code in `src/lib/rules/generate.ts` with unit tests:
  - Conditions are partitioned by subject: sender-side, recipient-side,
    stamp, and `current_day_of_week`.
  - Day-of-week conditions are evaluated once against the chosen day. If one
    fails, the rule is **infeasible for that day** — fail immediately with that
    reason instead of sampling forever.
  - For `match_mode = "all"` (the common case) each side's conditions are
    applied as a filter over the citizen directory, giving two candidate pools.
    Empty pool → deterministic "no citizen satisfies …" failure naming the
    condition that emptied it. Any pair drawn from the pools satisfies the rule.
  - For `any` / `exclusive` / negated conditions, fall back to a **bounded
    scan** over shuffled pairs (cap ~2000 combinations per letter), which
    terminates deterministically instead of retrying forever.
  - Stamp value: forced when the rule constrains it, otherwise valid.
  - Every candidate is finally run through `resolveDestination` to confirm the
    target rule is the unique winner against higher-precedence active rules;
    pairs stolen by a newer rule are skipped.
  - Randomness is injected (`rng` parameter) so the tests are deterministic.

## Test plan

- Unit: `destination.test.ts` (active-day windows, undated rank 0, cancelled
  before implemented, tie → conflict vs same-destination tie → resolved,
  matched-but-unassigned, no-match), `generate.test.ts` (satisfies target rule,
  avoids reuse, day-of-week infeasibility, empty pool, bounded-scan giving up
  cleanly), updated `evaluate.test.ts` including `is_not true|false` on stamp.
- Integration (`pnpm test:int`, local Supabase): bulk day-move re-ID, renumber,
  generator end-to-end against a seeded rule, `sorting_letters_view.content_id`
  after the view drop/recreate, plus an RLS spot-check that an anonymous client
  still can't read the recreated view.
- Manual: `/sorting/letters` — sort every column, open the panel from a row,
  toggle a stamp from both table and panel, run the generator, run each bulk
  action.

## Out of scope

- Extracting the `HeroSearch` combobox from `inspection/letters/workspace.tsx`
  into a shared component (a plain select is used instead).
- Persisting a letter's "intended rule" — deliberately not stored.
- Any change to how rules themselves are authored beyond the stamp rename.
