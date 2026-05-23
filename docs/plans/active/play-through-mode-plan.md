# Play-Through Mode — Implementation Plan

## Context

The team needs a "play through mode" to dress-rehearse the full show day-by-day before the physical space is built. Today the repo has a basic `/playthroughs/[id]` free-form editor (set day, phase, pick actions per letter) and the supporting domain (playthroughs row, action choices, variable HUD view, ending evaluator). What's missing is the *guided* experience: a runnable session with a game clock, phase timers, multi-user sync, navigable day/phase progression, reference lookups (map / cities / citizens), an ending screen, and a final log of timing + impact.

The free-form editor will be **replaced** at the same URL by the new guided mode (admin-only fields rehomed — see §1B). Timers are **server-time authoritative** (DB columns drive elapsed, on the client a one-time offset against `performance.now()` is re-synced every 30s; persistence + RPC writes use DB `now()` directly, no `Date.now()` math). Top-of-day and end-of-day are **untimed** (countdown only on sort/inspect). "Codex review" is a code-review subagent run against this plan before any code is written.

The **editor-side fallback primitive** shipped in `#130` (`inspection_letters.fallback_mirror_action_id`, see `docs/plans/active/letter-fallback-action-plan.md` — landed on `main`). What that PR explicitly deferred is **playthrough auto-apply** — turning a NULL choice into the mirrored action's impacts + next-letter when the player advances. **That auto-apply work is part of this plan (Track C5)** and is the only new fallback-side schema this plan introduces: `playthrough_action_choices.applied_via_fallback boolean default false`.

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

## Gate 0 — Codex review (cleared)

Codex review ran against `b3ee77a` and surfaced two BLOCKERs, several WARNINGs, and the dependency gaps below. All are folded into the sections that follow. Key resolutions:

- **`ending_framework_id` → `ending_document_id`.** `ending_frameworks` was dropped in `0022_endings_logic_v2.sql`; frameworks now live as rows in `ending_documents` with `kind='framework'`. Column name and FK updated in §1A and §Track E.
- **Fallback editor primitive shipped in `#130`.** Playthrough auto-apply is now an explicit Track C5 step (`playthrough_action_choices.applied_via_fallback`).
- **Storage RLS policies added to §1A** (creating the `playthrough-reference` bucket alone does not grant authenticated read/write).
- **Delivered-letters view grounded** in `inspection_letters_view.effective_day_id` + a recursive CTE over `actions.next_letter_id` from prior-day chosen actions (see §1A view spec).
- **Ending evaluator adapter spec'd** in Track E (map `playthrough_variables.*` columns → seeded `number_ref` variables via `PreviewSelections.numberRefByName`, then run `resolveAggregates` + `evaluateDocument`).
- **`PreviewView` is interactive**; Track C1 extracts a read-only sibling rather than reusing it directly. Helper `selectFiredReportSegments` extracted from its existing `firedSegmentIds` memo (preview-view.tsx:138-145).
- **Presence "leave" callback** is new wiring; added as §1C work so Track A can subscribe.
- **Sorting rules cap removed** (`0042_sorting_rules_revamp.sql` lifted the ≤3 limit) — Track C2 reads however many rows exist.
- **Settings page integration** is a new `<Card>` section in `src/app/(authed)/settings/page.tsx` (no general settings table — `user_home_tiles` is the only per-user data; reference-map URL goes in a new singleton table).
- **Admin controls rehomed** to a play-mode menu (§1B) rather than a separate `/edit` route.
- **Deep-link URL state** added to §Track D (`?day`, `?phase`, optional `?letter`).
- **Phase-log uniqueness** enforced via partial unique index in §1A.

No code is written before this section is checked off as resolved.

---

## Phase 1 — Foundation (serial; blocks everything else)

### 1A. Schema migration

`supabase/migrations/<ts>_playthrough_play_mode.sql` (use `supabase migration new`, timestamp prefix per CLAUDE.md). All FKs spelled out below; nothing is left implicit.

**ALTER `playthroughs` ADD**:
  - `started_at timestamptz`, `paused_at timestamptz`, `total_paused_ms bigint not null default 0`
  - `phase_started_at timestamptz`, `phase_paused_at timestamptz`, `phase_total_paused_ms bigint not null default 0`
  - `phase_allotted_override_ms bigint` (per-playthrough adjustments, applies only to current phase row)
  - `furthest_day_id uuid references public.days(id) on delete set null`
  - `furthest_phase phase` (drives forward-button visibility)
  - `started boolean not null default false`, `ended boolean not null default false`
  - `ending_document_id uuid references public.ending_documents(id) on delete set null` — resolved framework row (must satisfy `kind='framework'`; enforced by trigger below)

**Partial unique index on `playthroughs(is_active)`**: `create unique index playthroughs_one_active on public.playthroughs((true)) where is_active = true;` — closes the existing app-enforced race in `setActivePlaythrough` (`actions.ts:47-55`).

**Trigger** `playthroughs_validate_ending_document` (before insert/update): when `ending_document_id is not null`, `select kind from ending_documents where id = new.ending_document_id` must equal `'framework'`. Raises otherwise.

**ALTER `playthrough_action_choices` ADD**: `applied_via_fallback boolean not null default false`. Set true by Track C5's advance-phase RPC when the player advanced past inspection with no choice and the letter had `fallback_mirror_action_id is not null`.

**New table `playthrough_phase_log`** — `id uuid pk, playthrough_id uuid references playthroughs(id) on delete cascade, day_id uuid references days(id) on delete cascade, phase phase not null, entered_at timestamptz not null default now(), exited_at timestamptz, elapsed_ms bigint, allotted_ms bigint, overtime_ms bigint, superseded_at timestamptz, version int not null default 1`.
- **Partial unique index** `playthrough_phase_log_one_open on (playthrough_id, day_id, phase) where superseded_at is null and exited_at is null` — at most one open row per playthrough/day/phase at any time.

**New table `playthrough_phase_timer_adjustments`** — `id uuid pk, playthrough_id uuid references playthroughs(id) on delete cascade, day_id uuid references days(id) on delete cascade, phase phase not null, delta_ms bigint not null, applied_at timestamptz not null default now(), applied_by uuid references auth.users(id) on delete set null`.

**New table `playthrough_action_choice_history`** — `id uuid pk, playthrough_id uuid references playthroughs(id) on delete cascade, inspection_letter_id uuid references inspection_letters(id) on delete cascade, chosen_action_id uuid references actions(id) on delete set null, set_at timestamptz not null, unset_at timestamptz not null default now(), set_by uuid references auth.users(id) on delete set null, was_fallback boolean not null default false`.

**New table `playthrough_report_segments_fired`** — `id uuid pk, playthrough_id uuid references playthroughs(id) on delete cascade, day_id uuid references days(id) on delete cascade, report_segment_id uuid not null references report_segments(id) on delete cascade, fired_at timestamptz not null default now()`. Unique `(playthrough_id, day_id, report_segment_id)` so re-entering TOD doesn't duplicate.

**New singleton table `playthrough_reference_settings`** — `id uuid pk default uuid_generate_v4(), map_image_url text, updated_at timestamptz not null default now()`. Mirrors the singleton pattern from `ending_documents_singleton_kinds`. No existing general settings table — `src/app/(authed)/settings/page.tsx:38-84` composes `AccountSection`/`ChangePasswordSection`/`UsersSection` plus `user_home_tiles`, so this is the first per-app singleton.

**Supabase storage bucket** `playthrough-reference` — created in same migration:
```sql
insert into storage.buckets (id, name, public)
values ('playthrough-reference', 'playthrough-reference', true)
on conflict (id) do nothing;
```
Public reads (the map is decorative, no PII). Authenticated writes only:
```sql
create policy "playthrough_reference_public_read" on storage.objects
  for select to public
  using (bucket_id = 'playthrough-reference');

create policy "playthrough_reference_authed_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'playthrough-reference');

create policy "playthrough_reference_authed_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'playthrough-reference')
  with check (bucket_id = 'playthrough-reference');

create policy "playthrough_reference_authed_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'playthrough-reference');
```
(No existing `storage.objects` policies in `supabase/migrations/` — this is the first storage bucket the app owns.)

**Realtime publication** — add `playthroughs` (already in publication; column adds inherit), `playthrough_action_choices` (already in), and all four new tables to `supabase_realtime`; `alter table … replica identity full;` for each. Follow `0031_realtime_publication.sql`.

**RLS** — `alter table … enable row level security; create policy "all" on … for all to authenticated using (true) with check (true);` on each new table (mirrors existing `playthroughs` policy at `0001_init.sql:356-365`).

**New view `playthrough_delivered_letters_view`** — letters delivered on `playthroughs.current_day_id`, resolved correctly:
```sql
create view public.playthrough_delivered_letters_view as
-- Scheduled deliveries: anything whose effective_day_id matches the current day.
with scheduled as (
  select p.id as playthrough_id, ilv.*
  from public.playthroughs p
  join public.inspection_letters_view ilv on ilv.effective_day_id = p.current_day_id
),
-- Branch deliveries: walk actions.next_letter_id from prior-day chosen
-- actions (or fallback-mirrored actions). Recursive — a letter chained from
-- a prior-day branch may itself chain a later letter.
branch_seeds as (
  select pac.playthrough_id, a.next_letter_id as letter_id
  from public.playthrough_action_choices pac
  join public.actions a on a.id = pac.chosen_action_id
  join public.inspection_letters il on il.id = a.inspection_letter_id
  join public.inspection_letters_view ilv on ilv.id = il.id
  join public.playthroughs p on p.id = pac.playthrough_id
  join public.days d_src on d_src.id = ilv.effective_day_id
  join public.days d_cur on d_cur.id = p.current_day_id
  where a.next_letter_id is not null
    and d_src.number < d_cur.number
),
branch as (
  select bs.playthrough_id, ilv.*
  from branch_seeds bs
  join public.inspection_letters_view ilv on ilv.id = bs.letter_id
)
select * from scheduled
union
select * from branch;
```
- `scheduled` covers the normal case: any letter whose `effective_day_id` (override → offset → group day, per `0034`) lands on the current day.
- `branch` covers next-letter delivery: prior-day chosen actions whose `next_letter_id` points at a letter not in `scheduled` for that day.
- Fallback-applied choices populate `playthrough_action_choices` (Track C5) so the same branch-seed CTE captures them automatically.
- The view is per-playthrough; queries always filter `where playthrough_id = $1`.

### 1B. Replace editor + route shell

The current `/playthroughs/[id]/page.tsx` (`page.tsx:32-281`) bundles four responsibilities: viewing impacts/variables, free-form `current_day_id` + `current_phase` editing, action picking per-letter, and admin (name/notes/make-active/delete). Play mode subsumes the first three; admin is rehomed to a play-mode menu so we don't need a separate `/edit` route.

- **Delete** the body of `src/app/(authed)/playthroughs/[id]/page.tsx` and rewrite as a server component that loads playthrough + delivered letters (via `playthrough_delivered_letters_view`) + current day + phase log + variables + reference settings, then renders `<PlayModeShell>`. The `id` route param is the canonical state; URL search params `?day=<n>&phase=<phase>&letter=<id>` are read by `<PlayModeShell>` for deep-linking (Track D wires them).
- **New** `src/app/(authed)/playthroughs/[id]/layout.tsx` — opts out of the left nav. Add a `hideNav` flag to `src/components/app-shell.tsx` (a `NavStateProvider` the layout sets, mirroring `WorkspacePresenceProvider`'s `hideHud` pattern at `app-shell.tsx:41-67`). Do NOT duplicate the shell.
- **New** `src/app/(authed)/playthroughs/[id]/_components/play-mode-shell.tsx` — wraps children in `WorkspacePresenceProvider` with `channelName="playthrough:<id>"` and `broadcastEvents: ["next-phase-intent"]` (see §1C), hosts `<PlayNavbar>`, `<ReferencePanel>`, and the active phase component.
- **New** `src/app/(authed)/playthroughs/[id]/_components/play-navbar.tsx` — name | exit (back to `/playthroughs`) | day badge | phase label | `<GameTimer>` (Track A) | `<AvatarStack>` (reuse `src/lib/realtime/`) | `<PlayMenu>` (gear icon → name+notes edit, make-active toggle, delete — see rehoming below).
- **New** `src/app/(authed)/playthroughs/[id]/_components/play-menu.tsx` — kebab/gear popover that hosts the rehomed admin controls. Calls `updatePlaythrough`, `setActivePlaythrough`, `deletePlaythrough` (which stay on the list-page `actions.ts`). Delete goes through `useConfirm()`.
- **New** `src/app/(authed)/playthroughs/[id]/_actions/play-actions.ts` — host for all play-mode server actions (`startPlaythrough`, `pauseGame`, `resumeGame`, `adjustPhaseAllotment`, `restartPhaseTimer`, `advancePhase`, `goToPhase`, `endPlaythrough`, and the moved `chooseAction` / `clearChoice`).
- **Move** `chooseAction` / `clearChoice` from `src/app/(authed)/playthroughs/actions.ts` into `_actions/play-actions.ts`. Keep `createPlaythrough` / `deletePlaythrough` / `setActivePlaythrough` / `updatePlaythrough` on the list page (used by both list and the new `<PlayMenu>`).

**Revalidation surfaces** (called out per Codex finding) — every play-mode server action that changes `current_day_id`, `current_phase`, `started`, `ended`, or `is_active` calls all of:
- `revalidatePath("/")` — homepage tile shows active playthrough state.
- `revalidatePath("/playthroughs")` — list page.
- `revalidatePath("/playthroughs/[id]", "page")`.
- `revalidatePath("/days/[identifier]/top-of-day", "page")` when phase advances cross the TOD boundary (matches `days/actions.ts:85`).
The AppShell HUD (`app-shell.tsx:41-67`) is fed by client-side realtime, so it does not need a revalidate — its data refresh is handled by §1C subscriptions.

### 1C. Realtime + sync wiring

- Subscribe via `WorkspacePresenceProvider` to `postgresTables: ["playthroughs", "playthrough_action_choices", "playthrough_phase_log", "playthrough_phase_timer_adjustments", "playthrough_report_segments_fired"]`.
- **Extend `CUSTOM_BROADCAST_EVENTS`** in `src/lib/realtime/presence-context.tsx:25-26` from `["row-deleting"]` to `["row-deleting", "next-phase-intent"]` so the new event is auto-subscribed by every consumer. (Each playthrough channel gets its own `name`, so the event leaks no info to other channels.) Use `sendBroadcast("next-phase-intent", …)` for soft optimistic ack only — DB is the source of truth.
- **Add a presence-leave callback to `presence.ts`.** Today `presence.ts:354-360` (the `onPresenceSync` handler) derives `peers` from the post-sync state but does not surface a "this peer is about to leave" event. Track A needs to detect "I am the last remaining peer" to fire `pauseGame`. Add `onPresenceLeave?: (peer: PresencePeer) => void` to `WorkspacePresenceProviderProps`, wire it through `useRealtimeChannel` by subscribing to `ch.on("presence", { event: "leave" }, …)` (Supabase realtime emits a `leave` event before the sync that removes the peer), and expose it via `usePresenceContext()`.
- **New client hook `src/lib/playthrough/use-playthrough-sync.ts`** — wraps `usePresenceContext().onPostgresChanges`, re-fetches the playthrough row + choices + phase log + delivered-letters view on changes (use `router.refresh()` to re-run the server component query). Debounce ≥250ms — phase advancement can trigger several row writes from one RPC.

### Foundation acceptance

Two tabs open `/playthroughs/<id>`: both render the new shell with no left nav and a top navbar. Mutating `current_phase` in the SQL editor updates both tabs within ~1s. Old free-form editor UI is gone.

---

## Phase 2 — Parallel tracks (after Foundation)

### Track A — Timer system

**Depends on:** Foundation (specifically §1C's `onPresenceLeave` callback).

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
- **Auto-pause on zero presence**: subscribe to `onPresenceLeave` (added in §1C). When a leave event arrives and the post-sync `peers.length === 0`, the surviving client (if any) calls `pauseGame`. Best-effort: if the last tab simply closes there is no surviving client. Mitigation: on next join, if `phase_started_at + (now() - phase_paused_at)` exceeds the phase's allotted time by more than the threshold expected from a legitimate run, surface a one-time "Resume timer?" prompt rather than silently counting (the dialog uses `useConfirm()`).

**Reuse:** `src/lib/realtime/presence-context.tsx`, `src/lib/realtime/avatar-stack.tsx`.

**Verify:** Start playthrough in tab A → timer ticks. Pause in B → A pauses within ~500ms. Press +15s → phase remaining grows by 15s in both tabs. Press restart on phase timer → countdown reset, game timer rewinds elapsed phase amount, both tabs agree.

### Track B — Reference panel + settings upload

**Depends on:** Foundation only (storage bucket + RLS policies are in §1A). Independent of A, C, D, E.

- **New** `src/app/(authed)/settings/playthrough-reference-section.tsx` — client component, mirrors `account-section.tsx` shape: file input → `supabase.storage.from('playthrough-reference').upload(...)`, then writes `map_image_url` into the `playthrough_reference_settings` singleton via a server action. Preview of the current image with a "Replace" button. (No new route — Settings page is a single composed page at `src/app/(authed)/settings/page.tsx`.)
- **New** `src/app/(authed)/settings/playthrough-reference-actions.ts` — `setPlaythroughReferenceMap(url: string | null)` server action; upserts the singleton row, `revalidatePath("/settings")` + `revalidatePath("/playthroughs/[id]", "page")`.
- **Edit** `src/app/(authed)/settings/page.tsx` — load `playthrough_reference_settings` (single row) alongside the existing queries; add a new `<Card>` after the Users card titled "Playthrough reference" rendering `<PlaythroughReferenceSection />`.
- **New** `_components/reference-panel.tsx` — fixed bottom-left book icon button; popover with Map / City List / Citizen Directory tabs.
- **New** `_components/reference-map-popup.tsx` — modal overlay rendering `map_image_url`. If unset, render a "No reference map uploaded — set one in Settings" empty state linking to `/settings`.
- **New** `_components/reference-city-list.tsx` — right-side panel; `select * from cities order by name`; render code + name.
- **New** `_components/reference-citizen-directory.tsx` — right-side panel; `order by citizen_id`; render id + name + city code.

**Reuse:** existing `src/components/ui/` primitives (Dialog/Sheet); `src/lib/ids.ts` if needed. Settings form pattern from `src/app/(authed)/settings/account-section.tsx`.

**Verify:** Upload PNG in settings, open `/playthroughs/<id>`, click book icon, map appears with that PNG. City list sorted A→Z, citizen directory sorted by citizen_id. Reading from an unauthenticated session (e.g. signed-out browser) still serves the image (public bucket), but uploads require auth.

### Track C — Phase content rendering

**Depends on:** Foundation. The editor-side fallback primitive shipped in `#130` (`inspection_letters.fallback_mirror_action_id`); the playthrough auto-apply piece is C5 below. Sub-slices C1–C4 can be parallelized internally; C5 (the `advancePhase` RPC) gates all four for end-to-end progression.

- **C1 — Top of day** `_components/phase-top-of-day.tsx`. **`PreviewView` (`top-of-day/morning-reports/preview-view.tsx:33-50, 138-145`) is interactive** — it takes `selectedLetter` / `selectedAction` / `onSelectionChange` props from the editor and lets the user re-roll the sim. Play mode is a frozen snapshot driven by the playthrough's actual choices, so this slice does NOT reuse `PreviewView` directly. Two extractions:
  1. Pull `selectFiredReportSegments(actions, selectedActionByLetter)` out of the `firedSegmentIds` memo (`preview-view.tsx:138-145`) into `src/lib/playthrough/select-fired-segments.ts`. Pure function, no React.
  2. Build a new read-only `<MorningReportSummary>` component in `_components/` that takes pre-resolved letters + chosen actions and renders the same visual layout as `PreviewView` (lift the JSX into a shared subcomponent if the editor wants the read-only view too).

  On TOD entry, the `advancePhase` RPC (C5) inserts one row per fired segment into `playthrough_report_segments_fired` (the unique constraint in §1A makes re-entry idempotent).
- **C2 — Sorting** `_components/phase-sorting.tsx`. Read-only render of active sorting rules for the current day. Reuse rule chip components from `src/app/(authed)/sorting/`. The "≤3 conditions" cap mentioned in `CLAUDE.md` was lifted by `0042_sorting_rules_revamp.sql:30-48` — render however many condition rows the rule has. Embeds `<PhaseTimer>`.
- **C3 — Inspection** `_components/phase-inspection.tsx`. Queries `playthrough_delivered_letters_view` (see §1A view spec) filtered by `playthrough_id`. Renders rectangle per letter (recipient, sender, content_id badge). Click expands content; reuse the existing letter renderer used in `src/app/(authed)/inspection/letters/`. Action toggle wires to the moved `chooseAction`/`clearChoice` (the existing logic — `playthroughs/actions.ts:77-90` — works as-is, but the current `/playthroughs/[id]` page loads all letters and all actions without filtering by delivery, so the UI itself is new; only the server actions are reused). Letters with `fallback_mirror_action_id` set show a muted "Fallback: <action>" hint under the action row.
- **C4 — End of day** `_components/phase-end-of-day.tsx`. Untimed transition; "Next" advances.
- **C5 — `advancePhase` server action** + migration `<ts>_advance_phase_rpc.sql`. Single atomic SQL function:
  1. `select … for update` on the playthrough row.
  2. Verify `current_phase` matches the client's expected (idempotency token); mismatched → no-op.
  3. Close prior `playthrough_phase_log` row (set `exited_at`, `elapsed_ms`, `overtime_ms`). The partial unique index from §1A makes "find the open row" a single-row lookup.
  4. Open new `playthrough_phase_log` row (`entered_at = now()`, `superseded_at = null`).
  5. **If exiting inspection — auto-apply fallback choices**. For each `playthrough_delivered_letters_view` row matching the playthrough+day where (a) `playthrough_action_choices` has no row, AND (b) `inspection_letters.fallback_mirror_action_id is not null`, insert `playthrough_action_choices (playthrough_id, inspection_letter_id, chosen_action_id, applied_via_fallback)` values `(p.id, il.id, il.fallback_mirror_action_id, true)`. Letters with NULL fallback simply remain unset (no choice = no impact). The variable tally view (`playthrough_variables`) reads `playthrough_action_choices` so the impact lands automatically.
  6. **If entering top-of-day** — insert into `playthrough_report_segments_fired` per `selectFiredReportSegments` (extracted in C1) on conflict do nothing.
  7. If advancing past `(furthest_day_id, furthest_phase)`, update those.
  8. Reset `phase_started_at = now()`, zero `phase_total_paused_ms`, clear `phase_paused_at`.

**Reuse:** sorting rule renderers, inspection letter renderer, `formatInspectionLetterId` in `src/lib/ids.ts`, `tallyVariables` in `src/lib/playthrough/variables.ts`. **Note:** `PreviewView` itself is not reused — see C1 for the extraction.

**Verify per slice:** Start → morning report shows. Next → sorting rules + countdown ticks down. Next → letter rectangles with addresses; pick action OR leave it blank for a letter with a fallback; Next → EOD (the blank letter's fallback action is now applied — visible in the impact HUD); Next → next day's TOD. Two tabs stay synced through every transition. Phase timer flips to overtime if held past 0.

### Track D — Navigation back/forward

**Depends on:** Foundation + Track A (timer pause) + Track C (phase log shape).

- **New** `_components/phase-nav.tsx` — back/forward buttons + 600ms long-press popover listing all non-superseded `(day, phase)` log entries.
- **URL state for deep-linking.** `<PlayModeShell>` reads `?day=<number>&phase=<phase>&letter=<id>` from `useSearchParams()` and (a) on mount, if those params disagree with `playthroughs.current_day_id`/`current_phase` and the target is reachable (≤ furthest), call `goToPhase` once. (b) On every nav change, `router.replace` the URL to reflect the new state. (c) `?letter=<id>` deep-opens the named delivered letter in `phase-inspection.tsx` (matches the `?letter` pattern at `inspection/letters/page.tsx:112-180`). These params survive refresh and are shareable across users on the channel.
- **Server action `goToPhase(id, dayId, phase)`**:
  - Calls `pauseGame` first.
  - Sets `current_day_id`, `current_phase` to target.
  - Does NOT touch `furthest_*`.
  - Disables timer controls while `(current_day_id, current_phase) < (furthest_*)` (component-level disable + server-side guard in adjust/restart/start/pause actions when not at furthest).
- **Action choice cascade** — in `chooseAction` (modified) and `clearChoice` (modified), when the playthrough is at a past phase:
  - Resolve "downstream letters" via a new SQL helper `letters_downstream_of(letter_id)` (recursive CTE over `actions.next_letter_id`).
  - Move displaced choices into `playthrough_action_choice_history` with `unset_at=now()` and `was_fallback = playthrough_action_choices.applied_via_fallback`, then `DELETE` them from `playthrough_action_choices`.
  - Recompute downstream phase-log rows: mark them `superseded_at=now()` (Track E reads only non-superseded).
- **Forward button** — visible only when current cursor < furthest. Re-uses `advancePhase` with the recorded next state.

**Reuse:** existing `chooseAction` / `clearChoice` extended with cascade behavior; phase log structure from Track C.

**Verify:** Advance to Day 2 TOD. Hit back twice → at Day 1 Inspect, timer paused, ± disabled. Long-press back → list of completed phases. Jump to Day 1 TOD. Forward button appears. Change a Day 1 inspection action that points to a different next letter → Day 2's downstream choice for that branch is wiped (visible in peer tab). Newly-delivered variant on Day 2 has no chosen action. URL deep-link: paste `/playthroughs/<id>?day=2&phase=inspection` into a new tab → lands directly at Day 2 Inspect (peer tab catches up via realtime).

### Track E — Logging + final summary + ending screen

**Depends on:** Track A (elapsed helpers) + Track C (phase log entries + report-segments-fired log) + Track D (superseded marking).

- **Server action `endPlaythrough(id)`** — sets `ended=true`, evaluates the ending via `evaluateDocument` from `src/lib/endings/evaluator.ts` against the current `playthrough_variables` row, stores resolved `ending_document_id` (FK to `ending_documents` where `kind='framework'`, enforced by the trigger in §1A). Freezes the game timer.
- **Ending evaluator adapter** `src/lib/playthrough/ending-inputs.ts`. `evaluateDocument` takes an `EvalInputs` whose `selections: PreviewSelections` is keyed by `ending_variables.id`, not by impact-column name (`evaluator.ts:96-119, 642-648`). The adapter:
  1. Loads all `ending_variables` of `kind='number_ref'` that the framework references (seeded earlier per the endings system).
  2. Builds `selections.numbers` keyed by `variable_id` from `playthrough_variables.{gentry, clergy, military, peasantry, urbanites, agitators, intelligentsia, foreign, epicenter}` columns.
  3. Populates `selections.numberRefByName` (the impact-column→variable_id map the evaluator uses for aggregate chips).
  4. Calls `resolveAggregates(...)` once to pre-resolve aggregate winners; stashes the result in `selections.tiebreak_docs` / pre-resolved keys per `evaluator.ts:96-119`.
  5. Resolves the framework selection logic doc (`ending_documents` where `kind='framework_selection'`) via `evaluateDocument` to choose which framework runs.
  6. Calls `evaluateDocument` on the chosen framework's `EvalInputs` and returns the resolved framework `ending_documents.id` plus the rendered text blocks. Test this adapter with fixture variables matching real impact tallies (mirrors `endings/frameworks/preview-view.tsx:103-112`).
- **New** `_components/phase-ending.tsx` — runs the adapter, renders madlib text + the variable values referenced. If the framework selection logic returns no result, render an explicit "No ending matched (variables out of range)" state with the current variable values so the operator can diagnose.
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
supabase/migrations/<ts>_playthrough_play_mode.sql            (new — 1A; columns, FKs, RLS,
                                                                 storage bucket+policies,
                                                                 partial unique indexes,
                                                                 ending_document_id trigger,
                                                                 playthrough_delivered_letters_view)
supabase/migrations/<ts>_advance_phase_rpc.sql                (new — C5)
supabase/migrations/<ts>_pause_resume_rpc.sql                 (new — A)
src/components/app-shell.tsx                                   (mod — hideNav flag)
src/lib/realtime/presence.ts                                   (mod — onPresenceLeave prop)
src/lib/realtime/presence-context.tsx                          (mod — add "next-phase-intent"
                                                                  to CUSTOM_BROADCAST_EVENTS,
                                                                  expose onPresenceLeave)
src/app/(authed)/playthroughs/[id]/layout.tsx                  (new — 1B)
src/app/(authed)/playthroughs/[id]/page.tsx                    (rewrite — 1B)
src/app/(authed)/playthroughs/[id]/_actions/play-actions.ts    (new — 1B/A/C/D/E; hosts moved
                                                                 chooseAction + clearChoice)
src/app/(authed)/playthroughs/[id]/_components/                (new — many)
  play-mode-shell.tsx, play-navbar.tsx, play-menu.tsx,
  game-timer.tsx, phase-timer.tsx, phase-nav.tsx,
  phase-top-of-day.tsx, morning-report-summary.tsx,
  phase-sorting.tsx, phase-inspection.tsx, phase-end-of-day.tsx,
  phase-ending.tsx, final-log.tsx, reference-panel.tsx,
  reference-map-popup.tsx, reference-city-list.tsx,
  reference-citizen-directory.tsx
src/lib/playthrough/timer.ts                                   (new — A)
src/lib/playthrough/use-server-clock.ts                        (new — A)
src/lib/playthrough/use-playthrough-sync.ts                    (new — 1C)
src/lib/playthrough/select-fired-segments.ts                   (new — C1; extracted from
                                                                  preview-view.tsx:138-145)
src/lib/playthrough/ending-inputs.ts                           (new — E; PreviewSelections adapter)
src/app/(authed)/top-of-day/morning-reports/preview-view.tsx   (mod — export the extracted
                                                                  selectFiredReportSegments)
src/app/(authed)/settings/page.tsx                             (mod — add reference Card)
src/app/(authed)/settings/playthrough-reference-section.tsx    (new — B)
src/app/(authed)/settings/playthrough-reference-actions.ts     (new — B)
src/app/(authed)/playthroughs/actions.ts                       (mod — remove chooseAction +
                                                                  clearChoice; keep create /
                                                                  delete / setActive / update)
```

Reusable existing functions (do not re-invent):

- `tallyVariables`, `ZERO_VARIABLES`, `VARIABLE_LABELS` — `src/lib/playthrough/variables.ts`
- `evaluateRule`, `evaluateCondition` — `src/lib/rules/evaluate.ts`
- `evaluateDocument`, `resolveAggregates`, `EvalInputs`, `PreviewSelections` — `src/lib/endings/evaluator.ts` (note: no `evaluateFramework` — use `evaluateDocument` per `0022_endings_logic_v2.sql`)
- `formatInspectionLetterId`, `formatReportId`, `formatSortingLetterId` — `src/lib/ids.ts`
- `WorkspacePresenceProvider`, `usePresenceContext`, `AvatarStack` — `src/lib/realtime/` (extended in §1C with `onPresenceLeave`)
- `useConfirm`, `useUnsavedDialog` — `src/components/confirm-dialog.tsx`, `src/components/unsaved-dialog.tsx`
- `patchInspectionLetter` — `src/app/(authed)/inspection/letters/actions.ts:1477` (only relevant if a future change writes `fallback_mirror_action_id` from play mode; not needed for v1 since fallback is editor-only)

Explicitly NOT reused (despite naming overlap):

- `PreviewView` — interactive editor (`preview-view.tsx:33-50, 138-145`); play mode needs the new read-only `<MorningReportSummary>` (Track C1).

---

## Architectural risks

1. **Server-time vs client-time drift.** Persistence + RPC writes use DB `now()`. Display elapsed is derived from a client-side offset against `performance.now()` after one `select extract(epoch from now())` on mount, re-synced every 30s. Never compute persisted elapsed from `Date.now()` alone.
2. **Double-click "Next" race.** `advancePhase` RPC locks the playthrough row and compares an idempotency token `(expected_day_id, expected_phase)`; the loser is a no-op. Broadcast is only a UX hint. The partial unique index on `playthrough_phase_log` (§1A) makes a second-winner attempt impossible at the DB layer too.
3. **Back-nav cascade.** Single SQL function inside `goToPhase` and inside `chooseAction`/`clearChoice` when not at furthest. Choice history rows preserved in `playthrough_action_choice_history`; phase-log rows get `superseded_at=now()`, version bumped on new run.
4. **Soft-delete vs replace on redo.** Plan: soft-delete + insert new row, version+1. Final log filters `superseded_at IS NULL`.
5. **Auto-pause on zero presence.** Best-effort via the `onPresenceLeave` callback added in §1C. Tab-close races are not covered; mitigated by a "Resume timer?" prompt on next join when the elapsed gap exceeds expected phase length. A server cron is explicitly out-of-scope for v1.
6. **Replacing the existing editor URL.** Admin controls (name/notes edit, make-active, delete) rehomed to `<PlayMenu>` inside the new shell (§1B). Audit links to `/playthroughs/[id]` from `AppShell`, `src/app/(authed)/page.tsx`, top-of-day, graph; the URL still works — only the contents change.
7. **Storage bucket is public.** `playthrough-reference` allows public reads (the map is decorative). If a future iteration adds sensitive reference material (e.g. citizen photos with PII), flip the bucket to private and switch the policies to `using (auth.role() = 'authenticated')`.

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
