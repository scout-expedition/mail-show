# Play-Through Mode — Implementation Plan

## Context

The team needs a "play through mode" to dress-rehearse the full show day-by-day before the physical space is built. Today the repo has a basic `/playthroughs/[id]` free-form editor (set day, phase, pick actions per letter) and the supporting domain (playthroughs row, action choices, variable HUD view, ending evaluator). What's missing is the *guided* experience: a runnable session with a game clock, phase timers, multi-user sync, navigable day/phase progression, reference lookups (map / cities / citizens), an ending screen, and a final log of timing + impact.

The free-form editor will be **replaced** at the same URL by the new guided mode. Timers are **server-time authoritative** (DB columns drive elapsed, no `Date.now()` math). Top-of-day and end-of-day are **untimed** (countdown only on sort/inspect). "Codex review" is a code-review subagent run against this plan before any code is written.

Fallback actions on letters (used when the player doesn't pick one before "Next") are **assumed to land in a separate branch before** this plan begins. Track C's inspection slice depends on that primitive existing.

---

## Tracks at a glance

```
Gate 0 (Codex review of this plan)
       │
       ▼
Phase 1 — FOUNDATION (serial)
       │
       ├─► Track A — Timer system
       ├─► Track B — Reference panel + settings upload  (parallel to A,C,D)
       ├─► Track C — Phase content rendering (TOD / Sort / Inspect / EOD)
       │       │
       │       ▼
       │   Track D — Navigation back/forward
       │       │
       └────► Track E — Logging + final summary + ending screen
```

Each track ends at a manually verifiable slice; merge order can interleave A/B/C/D/E but D needs C's `advancePhase` shape and E needs A's elapsed helpers + C's phase log entries.

---

## Gate 0 — Codex review (before any code)

Spawn the `code-review` subagent against this plan file and resolve findings. Specifically ask it to pressure-test:

- Schema sufficiency for back-nav invalidation + per-phase logging (soft-delete vs replace).
- Server-time clock contract (single source of truth for elapsed).
- Auto-pause-on-zero-presence: is best-effort acceptable, or do we need a server-side cron?
- Are there admin flows that still need the raw `/playthroughs/[id]` editor? If yes, expose `/playthroughs/[id]/edit` as a separate route.
- Definition of "future accuracy" for the sorting phase summary (deferred — track E will stub it).

No code is written before this gate clears.

---

## Phase 1 — Foundation (serial; blocks everything else)

### 1A. Schema migration

`supabase/migrations/<ts>_playthrough_play_mode.sql` (use `supabase migration new`, timestamp prefix per CLAUDE.md):

- **ALTER `playthroughs` ADD**:
  - `started_at timestamptz`, `paused_at timestamptz`, `total_paused_ms bigint default 0`
  - `phase_started_at timestamptz`, `phase_paused_at timestamptz`, `phase_total_paused_ms bigint default 0`
  - `phase_allotted_override_ms bigint` (per-playthrough adjustments, applies only to current phase row)
  - `furthest_day_id uuid`, `furthest_phase phase` (drives forward-button visibility)
  - `started boolean default false`, `ended boolean default false`
  - `ending_framework_id uuid null`
- **New table `playthrough_phase_log`**: `id, playthrough_id, day_id, phase, entered_at, exited_at, elapsed_ms, allotted_ms, overtime_ms, superseded_at timestamptz null, version int default 1`. Soft-deletes on back-redo.
- **New table `playthrough_phase_timer_adjustments`**: `playthrough_id, day_id, phase, delta_ms, applied_at, applied_by`. Audit trail of +/- buttons.
- **New table `playthrough_action_choice_history`**: `playthrough_id, inspection_letter_id, chosen_action_id null, set_at, unset_at, set_by`. Audit trail when back-nav cascades wipe choices.
- **New table `playthrough_report_segments_fired`**: `playthrough_id, day_id, report_segment_id, fired_at`. Populated when a TOD phase opens; consumed by the final log.
- **New table `playthrough_reference_settings`** (singleton, key=id): `map_image_url`. Or fold into existing settings row if there is one (Codex gate to confirm).
- **Supabase storage bucket** `playthrough-reference` for the map image (created in same migration via `storage.buckets` insert).
- Add all new tables + altered `playthroughs` columns to `supabase_realtime` publication; set replica identity full (follow `0031_realtime_publication.sql`).
- RLS: mirror existing `playthroughs` policy (`for all to authenticated using (true) with check (true)`).

### 1B. Replace editor + route shell

- **Delete** the body of `src/app/(authed)/playthroughs/[id]/page.tsx` (current free-form editor) and rewrite as a server component that loads playthrough + delivered letters + current day + phase log + variables, then renders `<PlayModeShell>`.
- **New** `src/app/(authed)/playthroughs/[id]/layout.tsx` — opts out of the left nav. Prefer adding a `hideNav` mechanism to `src/components/app-shell.tsx` (e.g., via a `NavStateProvider` flag the layout sets) over duplicating the shell.
- **New** `src/app/(authed)/playthroughs/[id]/_components/play-mode-shell.tsx` — wraps children in `WorkspacePresenceProvider` with `channelName="playthrough:<id>"`, hosts `<PlayNavbar>`, `<ReferencePanel>`, and the active phase component.
- **New** `src/app/(authed)/playthroughs/[id]/_components/play-navbar.tsx` — name | exit (back to `/playthroughs`) | day badge | phase label | `<GameTimer>` (Track A) | `<AvatarStack>` (reuse `src/lib/realtime/`).
- **New** `src/app/(authed)/playthroughs/[id]/_actions/play-actions.ts` — host for all play-mode server actions.
- **Move** `chooseAction` / `clearChoice` / `updatePlaythrough` from `src/app/(authed)/playthroughs/actions.ts` into `_actions/play-actions.ts`. Keep `createPlaythrough` / `deletePlaythrough` / `setActivePlaythrough` on the list page.

### 1C. Realtime + sync wiring

- Subscribe via `WorkspacePresenceProvider` to `postgresTables: ["playthroughs", "playthrough_action_choices", "playthrough_phase_log", "playthrough_phase_timer_adjustments"]`.
- New client hook `src/lib/playthrough/use-playthrough-sync.ts` — wraps `usePresenceContext().onPostgresChanges`, re-fetches the playthrough row + choices on changes (or uses `router.refresh()`).
- Reuse `sendBroadcast("next-phase-intent", …)` for soft optimistic ack only — DB is the source of truth.

### Foundation acceptance

Two tabs open `/playthroughs/<id>`: both render the new shell with no left nav and a top navbar. Mutating `current_phase` in the SQL editor updates both tabs within ~1s. Old free-form editor UI is gone.

---

## Phase 2 — Parallel tracks (after Foundation)

### Track A — Timer system

**Depends on:** Foundation only.

- **New** `src/lib/playthrough/timer.ts` — pure helpers `gameElapsedMs(p, nowMs)`, `phaseElapsedMs(p, nowMs)`, `phaseRemainingMs(p, day, nowMs)`. Server time injected, no internal `Date.now()`.
- **New** `src/lib/playthrough/use-server-clock.ts` — fetches `select extract(epoch from now())` once on mount, stores offset against `performance.now()`, resyncs every 30s. Single source for "now" across timer components.
- **Server actions** in `_actions/play-actions.ts`:
  - `startPlaythrough(id)` — sets `started=true`, `started_at=now()`, `phase_started_at=now()`, `current_day_id=<first day by number>`, `current_phase='top_of_day'`.
  - `pauseGame(id)` / `resumeGame(id)` — atomic SQL function (migration `<ts>_pause_resume_rpc.sql`) toggles both game and phase pause columns together. Idempotent.
  - `adjustPhaseAllotment(id, deltaMs)` — inserts adjustment row + updates `phase_allotted_override_ms` (clamped to ≥0).
  - `restartPhaseTimer(id)` — appends a negative adjustment to `total_paused_ms` equal to elapsed phase time (so game clock rewinds the redone slice), resets `phase_started_at=now()`, zeros `phase_total_paused_ms`.
- **New components** in `_components/`:
  - `game-timer.tsx` (in navbar; pause/resume button)
  - `phase-timer.tsx` (sort + inspect only; countdown that flips to positive overtime past 0; pause/resume mirrors game; restart; ±5/15/30s buttons)
- **Auto-pause on zero presence**: when the last peer leaves (presence "leave" event arriving with `peers.length === 0` at the remaining client about to unmount), call `pauseGame`. Best-effort: if the last tab simply closes there's no client to fire. Mitigation: on next join, if `phase_started_at` differs suspiciously from `paused_at + total_paused_ms`, prompt "Resume timer?" rather than silently counting. Final shape to be settled in Codex gate.

**Reuse:** `src/lib/realtime/presence-context.tsx`, `src/lib/realtime/avatar-stack.tsx`.

**Verify:** Start playthrough in tab A → timer ticks. Pause in B → A pauses within ~500ms. Press +15s → phase remaining grows by 15s in both tabs. Press restart on phase timer → countdown reset, game timer rewinds elapsed phase amount, both tabs agree.

### Track B — Reference panel + settings upload

**Depends on:** Foundation only. Independent of A, C, D, E.

- **New** `src/app/(authed)/settings/playthrough-reference/page.tsx` + actions — upload PNG/JPG to Supabase storage bucket `playthrough-reference`; write URL to `playthrough_reference_settings`.
- **New** `_components/reference-panel.tsx` — fixed bottom-left book icon button; popover with Map / City List / Citizen Directory.
- **New** `_components/reference-map-popup.tsx` — modal overlay rendering the uploaded image.
- **New** `_components/reference-city-list.tsx` — right-side panel; `select * from cities order by name`; render code + name.
- **New** `_components/reference-citizen-directory.tsx` — right-side panel; `order by citizen_id`; render id + name + city code.

**Reuse:** existing `src/components/ui/` primitives (Dialog/Sheet); `src/lib/ids.ts` if needed. Settings form pattern from `src/app/(authed)/settings/account-section.tsx`.

**Verify:** Upload PNG in settings, open `/playthroughs/<id>`, click book icon, map appears with that PNG. City list sorted A→Z, citizen directory sorted by citizen_id.

### Track C — Phase content rendering

**Depends on:** Foundation; assumes fallback-action primitive shipped separately. Sub-slices C1–C4 can be parallelized internally; C5 (the `advancePhase` RPC) gates all four for end-to-end progression.

- **C1 — Top of day** `_components/phase-top-of-day.tsx`. Reuses `src/app/(authed)/top-of-day/morning-reports/preview-view.tsx` (`PreviewView`). Extract a helper `selectFiredReportSegments(dayId, vars)` from `top-of-day/morning-reports/_lib/` (or wherever the gating lives) so the play mode and the editor share it. On TOD entry, insert one row per fired segment into `playthrough_report_segments_fired`.
- **C2 — Sorting** `_components/phase-sorting.tsx`. Read-only render of active sorting rules for the current day. Reuse rule chip components from `src/app/(authed)/sorting/`. Embeds `<PhaseTimer>`.
- **C3 — Inspection** `_components/phase-inspection.tsx`. Queries `playthrough_delivered_letters_view` (new view in 1A — see below), renders rectangle per letter (recipient, sender, content_id badge). Click expands content; reuse the existing letter renderer used in `src/app/(authed)/inspection/letters/`. Action toggle wires to `chooseAction`/`clearChoice` (already implemented).
- **C4 — End of day** `_components/phase-end-of-day.tsx`. Untimed transition; "Next" advances.
- **C5 — `advancePhase` server action** + migration `<ts>_advance_phase_rpc.sql`. Single atomic SQL function:
  1. `select ... for update` on the playthrough row.
  2. Verify `current_phase` matches the client's expected (idempotency token); mismatched → no-op.
  3. Close prior `playthrough_phase_log` row (set `exited_at`, `elapsed_ms`, `overtime_ms`).
  4. Open new phase row.
  5. If exiting inspection: apply fallback actions for any unset letters via the to-be-shipped primitive.
  6. If advancing past `(furthest_day_id, furthest_phase)`, update those.
  7. Reset `phase_started_at`, zero `phase_total_paused_ms`.

- **New view `playthrough_delivered_letters_view`** in 1A: joins `inspection_letters_view` with chosen actions + next-letter chain, filters by `delivery_day_id == playthroughs.current_day_id` OR triggered-by-action-from-prior-day. The SQL exists conceptually in the codebase via `inspection_letters_view.effective_day_id`; this view layers the playthrough-specific next-letter resolution.

**Reuse:** `preview-view.tsx`, sorting rule renderers, inspection letter renderer, `formatInspectionLetterId` in `src/lib/ids.ts`, `tallyVariables` in `src/lib/playthrough/variables.ts`.

**Verify per slice:** Start → morning report shows. Next → sorting rules + countdown ticks down. Next → letter rectangles with addresses; pick action; Next → EOD; Next → next day's TOD. Two tabs stay synced through every transition. Phase timer flips to overtime if held past 0.

### Track D — Navigation back/forward

**Depends on:** Foundation + Track A (timer pause) + Track C (phase log shape).

- **New** `_components/phase-nav.tsx` — back/forward buttons + 600ms long-press popover listing all non-superseded `(day, phase)` log entries.
- **Server action `goToPhase(id, dayId, phase)`**:
  - Calls `pauseGame` first.
  - Sets `current_day_id`, `current_phase` to target.
  - Does NOT touch `furthest_*`.
  - Disables timer controls while `(current_day_id, current_phase) < (furthest_*)` (component-level disable + server-side guard in adjust/restart/start/pause actions when not at furthest).
- **Action choice cascade** — in `chooseAction` (modified) and `clearChoice` (modified), when the playthrough is at a past phase:
  - Resolve "downstream letters" via a new SQL helper `letters_downstream_of(letter_id)` (recursive CTE over `actions.next_letter_id`).
  - Move displaced choices into `playthrough_action_choice_history` with `unset_at=now()`, then `DELETE` them from `playthrough_action_choices`.
  - Recompute downstream phase-log rows: mark them `superseded_at=now()` (Track E reads only non-superseded).
- **Forward button** — visible only when current cursor < furthest. Re-uses `advancePhase` with the recorded next state.

**Reuse:** existing `chooseAction` / `clearChoice` extended with cascade behavior; phase log structure from Track C.

**Verify:** Advance to Day 2 TOD. Hit back twice → at Day 1 Inspect, timer paused, ± disabled. Long-press back → list of completed phases. Jump to Day 1 TOD. Forward button appears. Change a Day 1 inspection action that points to a different next letter → Day 2's downstream choice for that branch is wiped (visible in peer tab). Newly-delivered variant on Day 2 has no chosen action.

### Track E — Logging + final summary + ending screen

**Depends on:** Track A (elapsed helpers) + Track C (phase log entries + report-segments-fired log) + Track D (superseded marking).

- **Server action `endPlaythrough(id)`** — sets `ended=true`, evaluates ending framework via `evaluateDocument`/`evaluateFramework` from `src/lib/endings/evaluator.ts` against the current `playthrough_variables` row, stores resolved `ending_framework_id`. Freezes the game timer.
- **New** `_components/phase-ending.tsx` — runs framework eval, renders madlib text + the variable values referenced.
- **New** `_components/final-log.tsx` (or `_components/playthrough-log.tsx`; mount as a tab/screen at end). Aggregates:
  - Total elapsed; per-phase rollups from non-superseded `playthrough_phase_log`.
  - TOD slice: report segments fired (`playthrough_report_segments_fired` joined to `report_segments_view`), id + summary.
  - Sort slice: spent / allotted / diff. (Future-accuracy column stubbed as TBD per Gate 0.)
  - Inspect slice: spent / allotted / diff + delivered letters with id + summary + chosen-or-fallback action.
  - EOD slice: elapsed only.
  - Impact: per-letter chosen action + the per-action `impact_*` values + final tally (use `tallyVariables`).
  - Ending: framework name + each variable value referenced.

**Reuse:** `src/lib/endings/evaluator.ts`, `src/lib/playthrough/variables.ts`, `src/lib/ids.ts`.

**Verify:** Complete a 3-day playthrough. Ending screen renders madlib text matching framework logic for the accumulated variables. "Stop playthrough" → game timer frozen. Final log lists totals, per-phase rows (TOD reports, inspect deliveries, fallback-flagged actions), ending framework name, and the variables it references.

---

## Critical files to modify or create

```
supabase/migrations/<ts>_playthrough_play_mode.sql            (new — 1A)
supabase/migrations/<ts>_advance_phase_rpc.sql                (new — C5)
supabase/migrations/<ts>_pause_resume_rpc.sql                 (new — A)
src/components/app-shell.tsx                                   (mod — hideNav flag)
src/app/(authed)/playthroughs/[id]/layout.tsx                  (new — 1B)
src/app/(authed)/playthroughs/[id]/page.tsx                    (rewrite — 1B)
src/app/(authed)/playthroughs/[id]/_actions/play-actions.ts    (new — 1B/A/C/D/E)
src/app/(authed)/playthroughs/[id]/_components/                (new — many)
  play-mode-shell.tsx, play-navbar.tsx, game-timer.tsx,
  phase-timer.tsx, phase-nav.tsx, phase-top-of-day.tsx,
  phase-sorting.tsx, phase-inspection.tsx, phase-end-of-day.tsx,
  phase-ending.tsx, final-log.tsx, reference-panel.tsx,
  reference-map-popup.tsx, reference-city-list.tsx,
  reference-citizen-directory.tsx
src/lib/playthrough/timer.ts                                   (new — A)
src/lib/playthrough/use-server-clock.ts                        (new — A)
src/lib/playthrough/use-playthrough-sync.ts                    (new — 1C)
src/app/(authed)/settings/playthrough-reference/                (new — B)
src/app/(authed)/playthroughs/actions.ts                       (mod — slim down; remove chooseAction etc.)
```

Reusable existing functions (do not re-invent):

- `tallyVariables`, `ZERO_VARIABLES`, `VARIABLE_LABELS` — `src/lib/playthrough/variables.ts`
- `evaluateRule`, `evaluateCondition` — `src/lib/rules/evaluate.ts`
- `evaluateFramework`, `evaluateDocument`, `resolveAggregates` — `src/lib/endings/evaluator.ts`
- `formatInspectionLetterId`, `formatReportId`, `formatSortingLetterId` — `src/lib/ids.ts`
- `PreviewView` — `src/app/(authed)/top-of-day/morning-reports/preview-view.tsx`
- `WorkspacePresenceProvider`, `usePresenceContext`, `AvatarStack` — `src/lib/realtime/`
- `useConfirm`, `useUnsavedDialog` — `src/components/confirm-dialog.tsx`, `src/components/unsaved-dialog.tsx`

---

## Architectural risks (called out for Codex)

1. **Server-time vs client-time drift.** All elapsed is derived from `started_at`/`phase_started_at` columns; clients hold a one-time offset against `performance.now()` re-synced every 30s. Never compute elapsed from `Date.now()` alone.
2. **Double-click "Next" race.** `advancePhase` RPC locks the playthrough row and compares an idempotency token `(expected_day_id, expected_phase)`; the loser is a no-op. Broadcast is only a UX hint.
3. **Back-nav cascade.** Single SQL function inside `goToPhase` and inside `chooseAction`/`clearChoice` when not at furthest. Choice history rows preserved in `playthrough_action_choice_history`; phase-log rows get `superseded_at=now()`, version bumped on new run.
4. **Soft-delete vs replace on redo.** Plan: soft-delete + insert new row, version+1. Final log filters `superseded_at IS NULL`. Codex to confirm.
5. **Auto-pause on zero presence.** Best-effort via last-peer-leaving callback. Tab-close races are not covered; mitigated by a "Resume timer?" prompt on next join when the gap looks wrong. Codex to confirm acceptable vs adding a server cron.
6. **Replacing the existing editor URL.** Audit links to `/playthroughs/[id]` from `AppShell`, `src/app/(authed)/page.tsx`, top-of-day, graph, etc. If any admin flow needs raw editing, expose `/playthroughs/[id]/edit` as a separate route.

---

## End-to-end verification

After all tracks land:

1. From `/playthroughs`, create a new playthrough, open it, hit **Start**.
2. Open the same URL in a second tab — both render Day 1 / Top of Day, game timer ticking in lockstep, avatars in the navbar.
3. Click the **book icon** → confirm Map, City List, Citizen Directory.
4. Walk forward: TOD → Sort (timer counts down) → Inspect (pick actions, leave one unset to exercise fallback) → EOD → Day 2 TOD ... until the final day.
5. Mid-run: pause from tab B, confirm both tabs pause. Resume from A. Press `+15s` on sort timer, confirm both grow. Restart phase timer, confirm game clock rewinds the elapsed phase slice.
6. Use the back button to return to Day 1 Inspect. Change an action that has a `next_letter_id` distinct from the previous one. Confirm Day 2 inspection choices on the displaced branch are cleared in both tabs.
7. Forward button reappears; advance back to the furthest phase, then continue through to the ending screen.
8. Ending: madlib text renders against the current variables; framework + variables referenced are visible.
9. **Stop playthrough** freezes the game timer.
10. Final log: total + per-phase rows, fallback-fired actions flagged, ending framework + variables match the screen.
11. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:int` all green.
