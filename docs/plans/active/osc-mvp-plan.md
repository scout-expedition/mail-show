# Local OSC Send/Receive Bridge — Prototype

## Context

Mail-show is the control panel for an immersive mail-sorting theatre piece. Each show is a playthrough that walks through days × 4 phases (top-of-day / sorting / inspection / end-of-day) with physical letters carrying `SL######` RFID payloads, sorting rules that grade slot placements, and inspection-letter actions that move 9 impact variables. README Phase 4 (`README.md:119`) already lists "Mac desktop app + OSC + QLab integration" as planned scope.

You want a **bidirectional OSC prototype** that wires the app to two outside systems:

- **QLab** — outbound cue triggers + status mirror; inbound status queries.
- **RFID readers in the mail slots** — inbound only, drive sorting accuracy during the sorting phase and action selection during the inspection phase.

Two hard constraints shape the design:

1. **Vercel is serverless.** It cannot bind a UDP port, so OSC cannot live inside the deployed Next.js process. The integration must run as a **separate process**.
2. **Content authoring stays in Supabase for now**, but the show will eventually run fully locally. Anything we build needs to port cleanly into the Phase 4 desktop wrapper.

The natural fit is a **local Node sidecar** that connects to Supabase Realtime the same way the browser does, translates Postgres changes to OSC, and POSTs inbound OSC back through a thin Next API route that reuses existing Server Actions. When Phase 4 lands, the sidecar becomes a module of the Mac/Electron app — only the launcher changes.

## What needs to exist in the schema first

A few of the outbound/inbound triggers reference state that isn't in the DB yet. Treat these as **prerequisite migrations** before the bridge is useful:

- **Phase timer.** Add columns to `playthroughs` (or a `playthrough_phase_runs` table) for `phase_started_at`, `phase_paused_at`, `phase_duration_seconds`. Used by `phase start` / `phase pause` / `phase timer end` cues.
- **Letter status surface.** During inspection, RFID drops translate to either `flagged` (report slot) or `delivered` (any other slot) on a per-letter basis. The existing `playthrough_action_choices` table only knows the chosen action id — extend it (or add a sibling table) so an inbound RFID drop can record `flagged` without picking a specific action, and so `chooseAction()` can still take the slot-id-derived action otherwise. Decide between (a) adding the well-known "deliver" / "flag" actions as canonical rows the bridge resolves to, or (b) adding a `status` column. Option (a) keeps action-based variable tallying intact and is preferred.
- **Slot → letter mapping during sorting.** A short-lived `playthrough_slot_state` table keyed on (playthrough_id, slot_id) holding the current `physical_letter_id`. The bridge writes to it; the sorting view reads from it to run `evaluateRule()` from `src/lib/rules/evaluate.ts` against the slot's sorting rule.

These are scoped tightly to make OSC possible; full design lives outside this plan.

## Recommended approach

### 1. New package: `osc`

Add `osc` (the `colinbdclark/osc.js` package) as a dependency. UDP/TCP/WebSocket transports, pure JS, the standard JS library for QLab work.

### 2. Sidecar script: `scripts/osc-bridge.ts`

Long-running Node process launched via `pnpm osc:bridge`. Responsibilities:

- Binds UDP on `OSC_LISTEN_PORT` (default `57121`); sends to `OSC_SEND_HOST:OSC_SEND_PORT` (default `127.0.0.1:53000` — QLab).
- Optionally binds a **second listen port** for the RFID bridge if its hardware vendor pins a specific port (`OSC_RFID_LISTEN_PORT`). One process can serve multiple sockets; address-prefix routing keeps them straight.
- Creates a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` (RLS-free for prototype; harden later with a bridge user).
- Subscribes to Postgres changes on `playthroughs` (current_day_id, current_phase, phase_started_at, phase_paused_at), `playthrough_action_choices`, the new `playthrough_slot_state`, and whichever table drives report-segment selection for a morning report.
- Translates each change into the OSC paths in the address map; resolves IDs to the same display IDs the UI uses (`inspection_letters_view.content_id`, `report_segments_view.report_id`, sorting `S2-09`, physical `SL######`).
- Reads inbound OSC, validates against the address map, and POSTs to `/api/osc` over localhost.
- Runs a small **timer loop** (e.g. `setInterval` 250 ms) that compares `phase_started_at + phase_duration_seconds` to wall clock and fires `/show/phase/timer/end` exactly once when crossed. Keeps QLab from having to do clock math.

### 3. Address map: `src/lib/osc/address-map.ts`

Pure module — paths + (de)serializers + escape rules. Imported by sidecar, API route, and tests. Initial set:

**Outbound (mail-show → QLab):**
- `/show/day/set <int>` — fires when `current_day_id` changes; arg is the day number.
- `/show/phase/set <"top_of_day"|"sorting"|"inspection"|"end_of_day">`
- `/show/phase/start` — fires when `phase_started_at` transitions from null.
- `/show/phase/pause` — fires when `phase_paused_at` transitions from null.
- `/show/phase/resume` — fires when `phase_paused_at` clears with `phase_started_at` still set.
- `/show/phase/next` — sidecar-emitted right after a phase change concludes the previous one (convenience cue for QLab).
- `/show/phase/timer/end` — fires once when the timer crosses zero.
- `/show/report/segment <"R-W2/ii">` — fires when the morning-report selection changes.
- `/show/status/day <int>`, `/show/status/phase <string>`, `/show/status/timer <remainingMs:int> <runningBool>` — sent both proactively on change **and** as replies to inbound status queries (see below).

**Inbound from QLab (queries):**
- `/show/status/day/get`, `/show/status/phase/get`, `/show/status/timer/get`, `/show/status/letter/get <"IL-W2/b3">` — sidecar replies on the `/show/status/*` paths above. QLab can route replies as it likes via its own listening port.

**Inbound from RFID readers (sorting phase):**
- `/rfid/slot <slotId:int> <payload:"SL######">` — sidecar resolves `payload` → `physical_letters.id`, upserts `playthrough_slot_state` (playthrough_id, slot_id, physical_letter_id, observed_at), and triggers a re-evaluation of the slot's sorting rule via `evaluateRule()` (`src/lib/rules/evaluate.ts`). The browser, subscribed via Supabase Realtime, sees the slot state change and re-renders the sorting accuracy grid.
- `/rfid/slot/clear <slotId:int>` — slot emptied; sidecar deletes the row.

**Inbound from RFID readers (inspection phase):**
- `/rfid/slot <slotId:int> <payload:"SL######">` — the same address. The bridge looks at `playthroughs.current_phase`:
  - `inspection` + slot is the well-known "report" slot → resolve the `physical_letter` to the inspection letter it points at and invoke a new server action `flagLetter(letterId)`.
  - `inspection` + any other slot → resolve to inspection letter and invoke `chooseAction(letterId, "deliver")`.
  - `sorting` → the sorting branch above; no action choice fires.

Settle escape rules for slashes in content IDs (`IL-W2/b3` collides with the OSC path separator). Recommended: keep them as **arguments**, not path segments — emit `/show/status/letter "IL-W2/b3" "delivered"` rather than embedding the ID in the path. This also makes the address map small and easy to grep.

### 4. Inbound API route: `src/app/api/osc/route.ts`

POST endpoint gated by `OSC_BRIDGE_SECRET` header. Validates a typed payload and dispatches to existing Server Actions — the bridge stays a dumb transport:

- `chooseAction()` in `src/app/(authed)/playthroughs/actions.ts` for `deliver`.
- `flagLetter()` — **new** thin action in the same file, wraps the choose path but resolves to the canonical "flag" action row.
- Phase/day mutations in `src/app/(authed)/days/actions.ts` (existing).
- `applySlotObservation(playthroughId, slotId, payload)` — **new** in `src/app/(authed)/sorting/rules/actions.ts`. Looks up physical letter, upserts `playthrough_slot_state`, runs `evaluateRule()` against the slot's rule, persists the pass/fail result. Returns the eval outcome so the bridge can mirror it back over OSC if desired.

Going through Server Actions keeps RLS, zod validation, and `revalidatePath()` consistent with the UI path.

### 5. Realtime subscription pattern

Don't rewrite the plumbing in `src/lib/realtime/channel.ts` — that's a React hook. The sidecar uses `supabase.channel(...).on('postgres_changes', ...)` directly in Node. Mirror the auth handling (`getSession`/`setAuth` before `subscribe()`).

### 6. Scripts + env

`package.json`:
- `"osc:bridge": "tsx --env-file=.env.local scripts/osc-bridge.ts"` (mirrors `db:migrate`).

`.env.local` keys (document in README, not committed):
- `OSC_LISTEN_PORT`, `OSC_SEND_HOST`, `OSC_SEND_PORT`, `OSC_RFID_LISTEN_PORT`, `OSC_BRIDGE_SECRET`, `OSC_BRIDGE_PLAYTHROUGH_ID` (which playthrough the bridge is "the show right now" — keeps the prototype simple; later replace with `is_active`).

## Critical files

- **New:** `scripts/osc-bridge.ts` — sidecar entrypoint.
- **New:** `src/lib/osc/address-map.ts` — paths, serializers, validators; pure, vitest-friendly.
- **New:** `src/app/api/osc/route.ts` — inbound POST, secret-gated, delegates to Server Actions.
- **New migrations:** phase-timer columns on `playthroughs`; `playthrough_slot_state` table; canonical "flag" action row (or `flagLetter` action wrapper); seed/lookup for slot ids → role (report slot vs others) in the inspection phase.
- **Touch:** `src/app/(authed)/playthroughs/actions.ts` — add `flagLetter`, phase start/pause/resume helpers.
- **Touch:** `src/app/(authed)/sorting/rules/actions.ts` — add `applySlotObservation`.
- **Touch:** `package.json` — `osc` dep + `osc:bridge` script.
- **Reuse:** `src/lib/ids.ts`, `src/lib/rules/evaluate.ts`, `src/lib/playthrough/variables.ts`, `inspection_letters_view`, `report_segments_view`, `physical_letters` table, the existing `chooseAction()` server action.

## Verification

Against a local Supabase stack (`supabase start`) with a seeded playthrough:

1. **Loopback outbound.** `pnpm osc:bridge` with `OSC_SEND_PORT=9000`. In a second terminal, watch with `oscdump 9000` (or Protokol). Change the day / advance the phase / pick an action / select a report segment in the UI; confirm each fires the right address with the expected args. Pause the phase; confirm `/show/phase/pause` then `/show/phase/timer/end` arrives when the timer expires.
2. **QLab cue smoke test.** Point the bridge at a QLab workspace listening on `53000`. Wire Network Cues triggered by `/show/phase/set sorting` and `/show/phase/timer/end`. Advance phase; cues fire. Add a Network Cue that sends `/show/status/day/get` back; confirm the bridge replies with `/show/status/day <n>`.
3. **RFID sorting flow.** With `sendosc` simulating the reader, fire `/rfid/slot 3 SL000042` while the playthrough is in the `sorting` phase. Verify `playthrough_slot_state` has a row, the sorting UI updates over Realtime, and `evaluateRule()` returns the expected pass/fail.
4. **RFID inspection flow.** Advance to `inspection`. Fire `/rfid/slot 0 SL000042` (report slot id) — confirm the letter is flagged. Fire `/rfid/slot 1 SL000042` (any other slot) — confirm the deliver action is recorded in `playthrough_action_choices` and the variable HUD tallies update.
5. **Address-map unit tests.** Vitest covering: each outbound path serializes correctly; each inbound path validates and rejects malformed args; content-ID arguments survive round-trip (`IL-W2/b3`, `SL000042`, `R-W2/ii`).
6. **`pnpm typecheck` + `pnpm lint` + `pnpm test`** clean.

## Migration to Phase 4 (forward-looking)

When the Mac/Electron wrapper ships:

- `scripts/osc-bridge.ts` becomes a module imported by the desktop app's main process.
- The address map and API route stay as-is; the API route runs against a local Next instance or is swapped for direct in-process calls.
- Supabase Realtime can be replaced with local SQLite/Postgres subscriptions without touching the address map.

Nothing in this prototype paints us into a corner.
