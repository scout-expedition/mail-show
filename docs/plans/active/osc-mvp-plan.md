# Local OSC Send/Receive Bridge — Prototype

## Context

Mail-show is the control panel for an immersive mail-sorting theatre piece. Each show is a playthrough that walks through days × 4 phases (top-of-day / sorting / inspection / end-of-day) with physical letters carrying `SL######` RFID payloads, sorting rules that grade slot placements, and inspection-letter actions that move 9 impact variables. README Phase 4 (`README.md:119`) already lists "Mac desktop app + OSC + QLab integration" as planned scope.

You want a **bidirectional OSC prototype** that wires the app to two outside systems:

- **QLab** — outbound cue triggers + status mirror; inbound status queries.
- **RFID readers in the mail slots** — inbound only, drive sorting accuracy during the sorting phase and action selection during the inspection phase.

Two hard constraints shape the design:

1. **Vercel is serverless.** It cannot bind a UDP port, so OSC cannot live inside the deployed Next.js process. The integration must run as a **separate process**.
2. **Content authoring stays in Supabase for now**, but the show will eventually run fully locally. Anything we build needs to port cleanly into the Phase 4 desktop wrapper.

The natural fit is a **local Node sidecar** that connects to Supabase Realtime the same way the browser does, translates Postgres changes to OSC, and POSTs inbound OSC back through a thin Next API route that delegates to **domain helpers** (not Server Actions directly — Server Actions depend on cookie auth via `createSupabaseServerClient()` in `src/lib/supabase/server.ts`, which the route doesn't have). The route uses `createSupabaseServiceClient()` for the prototype, gated by a header secret. When Phase 4 lands, the sidecar becomes a module of the Mac/Electron app and the same domain helpers run in-process; the OSC adapter layer (`src/lib/osc/*`) is the stable boundary.

**Topology for the prototype:** sidecar runs on the show machine and POSTs to `http://localhost:3000/api/osc` (local `pnpm dev` / Electron-hosted Next). The Vercel deployment is for content authoring only — `OSC_API_BASE_URL` env var picks the target so the same sidecar can hit a tunneled Vercel URL during remote rehearsals without a code change.

## What needs to exist in the schema first

A few of the outbound/inbound triggers reference state that isn't in the DB yet. Treat these as **prerequisite migrations** before the bridge is useful:

- **Phase timer.** Add `phase_started_at`, `phase_paused_at` to `playthroughs` for run-time state. Do **not** add `phase_duration_seconds` — `days` already has `sort_phase_length_seconds` and `inspection_phase_length_seconds` (`src/lib/db/types.ts:68-70`); the sidecar reads the configured duration from the current day row. Used by `phase start` / `phase pause` / `phase timer end` cues.
- **Letter status surface.** Approach (a) — **canonical "Deliver" and "Flag" action templates**, with a `flagLetter()` helper that finds (or lazily inserts) the per-letter action row pointing at the right template and records it via the same path as `chooseAction()`. Actions are per-letter rows pointing to templates (`supabase/migrations/0001_init.sql:369-377`, `0002_action_templates.sql:25-33`), so the helper must handle "the action row for this `inspection_letter_id` + Deliver/Flag template doesn't exist yet" by inserting it on first use. Preferred over a `status` column because it keeps the 9-variable impact tally intact for free.
- **Slot → letter mapping during sorting.** A `playthrough_slot_state` table keyed on (playthrough_id, slot_id) holding `physical_letter_id`, `sorting_rule_id`, `passed`, `evaluated_at`, `error_code`, `observed_at`. The route writes to it; the sorting view reads from it to render the accuracy grid. Including the eval result avoids a second round-trip for the UI.
- **Slot-role lookup.** Sorting rules already use numeric `destination_slot` 1-8 (`0001_init.sql:323-330`) with `routes_to_reporting` as a separate boolean destination (`0042_sorting_rules_revamp.sql:56-63`). Add a small `slots` reference table mapping `slot_id` → `role` (`report` | `sorting`) so the inspection-phase branch isn't relying on magic numbers, and so verification doesn't ship hardcoded slot `0`.
- **Realtime publication.** Add `playthroughs`, `playthrough_action_choices`, and `playthrough_slot_state` to the realtime publication with `REPLICA IDENTITY FULL`, mirroring the pattern in `supabase/migrations/0031_realtime_publication.sql`. Without this, the sidecar's `postgres_changes` subscription is silent.

These are scoped tightly to make OSC possible; full design lives outside this plan.

## Recommended approach

### 1. New package: `osc`

Add `osc` (the `colinbdclark/osc.js` package) as a dependency. UDP/TCP/WebSocket transports, pure JS, the standard JS library for QLab work.

### 2. Sidecar script: `scripts/osc-bridge.ts`

Long-running Node process launched via `pnpm osc:bridge`. Responsibilities:

- Binds UDP on `OSC_LISTEN_PORT` (default `57121`); sends to `OSC_SEND_HOST:OSC_SEND_PORT` (default `127.0.0.1:53000` — QLab). For QLab status replies it can either use the configured send target or "reply to UDP sender" — pick one and document. Recommend a separate `OSC_QLAB_REPLY_HOST/PORT` so query/reply routing stays explicit.
- Optionally binds a **second listen port** for the RFID bridge if its hardware vendor pins a specific port (`OSC_RFID_LISTEN_PORT`). One process can serve multiple sockets; address-prefix routing keeps them straight.
- Creates a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` (RLS-free for prototype; harden later with a bridge user). **Read-only role:** the sidecar only reads via Realtime and never mutates the DB directly — all writes go through `/api/osc` so eval logic, RLS-equivalent checks, and `revalidatePath()` stay in one place.
- Subscribes to Postgres changes on `playthroughs` (current_day_id, current_phase, phase_started_at, phase_paused_at), `playthrough_action_choices`, the new `playthrough_slot_state`, and whichever table drives report-segment selection for a morning report.
- Translates each change into the OSC paths in the address map; resolves IDs to the same display IDs the UI uses (`inspection_letters_view.content_id` → `L-W2/b3`, `report_segments_view.report_id` → `R-W2/ii`, sorting `S2-09`, physical `SL######`).
- Reads inbound OSC, validates against the address map, and POSTs to `${OSC_API_BASE_URL}/api/osc` (defaults to `http://localhost:3000`).
- Defaults the "current show" to the row with `playthroughs.is_active = true` (`src/lib/db/types.ts:280-287`); `OSC_BRIDGE_PLAYTHROUGH_ID` is an override for rehearsal/test only.
- Runs a small **timer loop** (e.g. `setInterval` 250 ms) that compares `phase_started_at + day.[sort|inspection]_phase_length_seconds` to wall clock and fires `/show/phase/timer/end` exactly once when crossed. Keeps QLab from having to do clock math.

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
- `/show/status/day/get`, `/show/status/phase/get`, `/show/status/timer/get`, `/show/status/letter/get <"L-W2/b3">` — sidecar replies on the `/show/status/*` paths above. QLab can route replies as it likes via its own listening port.

**Inbound from RFID readers (sorting phase):**
- `/rfid/slot <slotId:int> <payload:"SL######">` — sidecar forwards verbatim to `/api/osc`. The **route** resolves `payload` → `physical_letters.id`, looks up the active day's sorting rule for `slotId`, runs `evaluateRule()` (`src/lib/rules/evaluate.ts`), and upserts `playthrough_slot_state`. The browser, subscribed via Supabase Realtime, sees the row change and re-renders the sorting accuracy grid.
- `/rfid/slot/clear <slotId:int>` — slot emptied; route deletes the row.

**Inbound from RFID readers (inspection phase):**
- `/rfid/slot <slotId:int> <payload:"SL######">` — the same address. The **route** looks at `playthroughs.current_phase` and the `slots.role` lookup:
  - `inspection` + `slots.role = 'report'` → resolve the `physical_letter` to the inspection letter it points at and invoke `flagLetter(letterId)`.
  - `inspection` + `slots.role = 'sorting'` → resolve to inspection letter and invoke `chooseAction(letterId, "deliver")`.
  - `sorting` → the sorting branch above; no action choice fires.

**Sidecar ownership:** sidecar is UDP I/O + Realtime → OSC translation only. **All DB mutations and rule evaluation happen in `/api/osc`** so RLS-equivalent checks, zod validation, and `revalidatePath()` stay in one place. The route returns the eval outcome (pass/fail, error_code) and the sidecar mirrors it back over OSC as `/show/status/slot <slotId> <"pass"|"fail">` if desired.

**Rule evaluator lookup chain** (route side): RFID payload → `physical_letters` row → `content_ref_type/content_ref_id` (`0001_init.sql:306-312`, no FK) → if payload doesn't match a content row for the current phase (e.g. an inspection letter scanned during sorting), record `error_code = 'wrong_phase'` on `playthrough_slot_state` and skip evaluation. Otherwise resolve the active day's sorting rule for `slotId`, build a full `RuleContext` (`src/lib/rules/evaluate.ts:190-194`) from the sorting letter view + day rules/conditions, and persist the result.

Settle escape rules for slashes in content IDs (`L-W2/b3` collides with the OSC path separator). Recommended: keep them as **arguments**, not path segments — emit `/show/status/letter "L-W2/b3" "delivered"` rather than embedding the ID in the path. This also makes the address map small and easy to grep.

### 4. Inbound API route: `src/app/api/osc/route.ts`

POST endpoint gated by `OSC_BRIDGE_SECRET` header (constant-time compare). It **cannot call existing Server Actions directly** — those depend on cookie auth via `createSupabaseServerClient()` (`src/lib/supabase/server.ts:5-14`), and the request has no session. Instead:

- **Refactor:** extract the bodies of `chooseAction()` (`src/app/(authed)/playthroughs/actions.ts`) and the phase/day mutations (`src/app/(authed)/days/actions.ts`) into **client-agnostic domain helpers** under `src/lib/playthroughs/*` and `src/lib/days/*` that accept a `SupabaseClient` argument. The existing Server Actions become thin wrappers that pass the cookie-aware client; the route passes a service-role client from `createSupabaseServiceClient()` (`src/lib/supabase/server.ts:34-46`).
- **New domain helpers** the route calls:
  - `chooseAction(client, { playthroughId, letterId, templateName: "deliver" })`
  - `flagLetter(client, { playthroughId, letterId })` — finds (or lazily inserts) the per-letter action row pointing at the canonical "Flag" template, then records the choice via the same `chooseAction` path.
  - `applySlotObservation(client, { playthroughId, slotId, payload })` — implements the lookup chain above and upserts `playthrough_slot_state`.
  - `startPhase(client, ...)`, `pausePhase(...)`, `resumePhase(...)`, `setCurrentDay(...)` — phase-timer mutations.
- **Server-action wrappers stay** in their current files and continue to call `revalidatePath()`; the route additionally calls `revalidatePath('/playthroughs', 'layout')` after a successful mutation so UI surfaces re-fetch.

Routing through one place keeps zod validation, error codes, and revalidation consistent across UI and OSC paths. The service-role bypass is acceptable for prototype (show-floor LAN); upgrade path is documented below.

### 5. Realtime subscription pattern

Don't rewrite the plumbing in `src/lib/realtime/channel.ts` — that's a React hook. The sidecar uses `supabase.channel(...).on('postgres_changes', ...)` directly in Node. Mirror the auth handling (`getSession`/`setAuth` before `subscribe()`).

### 6. Scripts + env

`package.json`:
- `"osc:bridge": "tsx --env-file=.env.local scripts/osc-bridge.ts"` (mirrors `db:migrate`).

`.env.local` keys (document in README, not committed):
- `OSC_LISTEN_PORT`, `OSC_SEND_HOST`, `OSC_SEND_PORT`, `OSC_QLAB_REPLY_HOST`, `OSC_QLAB_REPLY_PORT`, `OSC_RFID_LISTEN_PORT`, `OSC_API_BASE_URL` (default `http://localhost:3000`), `OSC_BRIDGE_SECRET`, `OSC_BRIDGE_PLAYTHROUGH_ID` (override — defaults to `playthroughs.is_active = true`).

### 7. Security upgrade path

Prototype security model: header secret + service-role client + localhost transport. Adequate for a show-floor LAN where the sidecar and Next process run on the same machine. **Do not expose `/api/osc` over public internet in this form.** When the show eventually runs remote rehearsals via a tunneled Vercel URL, upgrade `/api/osc` to HMAC-over-body with a timestamp window (reject stale or replayed requests) before flipping `OSC_API_BASE_URL` to the public host. Phase 4 sidesteps the question entirely — Electron calls the domain helpers in-process.

## Critical files

- **New:** `scripts/osc-bridge.ts` — sidecar entrypoint (UDP I/O + Realtime → OSC translation; no DB writes).
- **New:** `src/lib/osc/address-map.ts` — paths, serializers, validators; pure, vitest-friendly. **The stable Phase 4 boundary.**
- **New:** `src/app/api/osc/route.ts` — inbound POST, secret-gated, calls domain helpers with a service-role client.
- **New:** `src/lib/playthroughs/mutations.ts` and `src/lib/days/mutations.ts` — client-agnostic domain helpers (`chooseAction`, `flagLetter`, `startPhase`, `pausePhase`, `resumePhase`, `setCurrentDay`, `applySlotObservation`).
- **New migrations:**
  - `phase_started_at`, `phase_paused_at` on `playthroughs` (do NOT add `phase_duration_seconds` — reuse `days.[sort|inspection]_phase_length_seconds`).
  - `playthrough_slot_state(playthrough_id, slot_id, physical_letter_id, sorting_rule_id, passed, evaluated_at, error_code, observed_at)`.
  - Canonical "Deliver" and "Flag" rows in `action_templates`.
  - `slots(slot_id, role)` reference table — replaces the magic "slot 0 = report" assumption.
  - Add `playthroughs`, `playthrough_action_choices`, `playthrough_slot_state` to the realtime publication with `REPLICA IDENTITY FULL` (pattern: `supabase/migrations/0031_realtime_publication.sql`).
- **Refactor (thin wrapper pattern):** `src/app/(authed)/playthroughs/actions.ts` and `src/app/(authed)/days/actions.ts` — existing Server Actions become wrappers that pass the cookie client to the new domain helpers.
- **Touch:** `package.json` — `osc` dep + `osc:bridge` script.
- **Reuse:** `src/lib/ids.ts`, `src/lib/rules/evaluate.ts`, `src/lib/playthrough/variables.ts`, `src/lib/supabase/server.ts` (both client factories), `inspection_letters_view`, `report_segments_view`, `physical_letters` table.

## Verification

Against a local Supabase stack (`supabase start`) with a seeded playthrough:

1. **Loopback outbound.** `pnpm osc:bridge` with `OSC_SEND_PORT=9000`. In a second terminal, watch with `oscdump 9000` (or Protokol). Change the day / advance the phase / pick an action / select a report segment in the UI; confirm each fires the right address with the expected args. Pause the phase; confirm `/show/phase/pause` then `/show/phase/timer/end` arrives when the timer expires.
2. **QLab cue smoke test.** Point the bridge at a QLab workspace listening on `53000`. Wire Network Cues triggered by `/show/phase/set sorting` and `/show/phase/timer/end`. Advance phase; cues fire. Add a Network Cue that sends `/show/status/day/get` back; confirm the bridge replies with `/show/status/day <n>`.
3. **RFID sorting flow.** With `sendosc` simulating the reader, fire `/rfid/slot 3 SL000042` while the playthrough is in the `sorting` phase. Verify the route resolved the payload, `playthrough_slot_state` has a row with `passed` populated, the sorting UI updates over Realtime, and `evaluateRule()` returned the expected pass/fail. Then fire a payload that doesn't match the current phase and confirm `error_code = 'wrong_phase'` is recorded without crashing.
4. **RFID inspection flow.** Advance to `inspection`. Fire `/rfid/slot <slot with role='report'> SL000042` — confirm the letter is flagged. Fire `/rfid/slot <slot with role='sorting'> SL000042` — confirm the deliver action is recorded in `playthrough_action_choices` and the variable HUD tallies update. (Slot ids resolved from the `slots` reference table — no hardcoded numbers.)
5. **Realtime publication.** After running the prerequisite migrations, confirm via `select * from pg_publication_tables where pubname = 'supabase_realtime'` that `playthroughs`, `playthrough_action_choices`, and `playthrough_slot_state` are in the publication. Without this, the sidecar's subscription is silently empty.
6. **Address-map unit tests.** Vitest covering: each outbound path serializes correctly; each inbound path validates and rejects malformed args; content-ID arguments survive round-trip (`L-W2/b3`, `SL000042`, `R-W2/ii`).
7. **Route auth tests.** Vitest/integration covering: missing/wrong `OSC_BRIDGE_SECRET` returns 401; malformed body returns 400 with zod error; valid body invokes the right helper.
8. **`pnpm typecheck` + `pnpm lint` + `pnpm test`** clean.

## Migration to Phase 4 (forward-looking)

When the Mac/Electron wrapper ships:

- `scripts/osc-bridge.ts` becomes a module imported by the desktop app's main process.
- `src/lib/osc/address-map.ts` and the domain helpers under `src/lib/playthroughs/*` / `src/lib/days/*` stay as-is — they're the stable boundary. The API route is dropped in favor of direct in-process calls to the same helpers.
- Supabase Realtime can be replaced with local SQLite/Postgres subscriptions without touching the address map.
- Security model (`OSC_BRIDGE_SECRET` / service-role client) is no longer relevant — Electron is the trust boundary.

Nothing in this prototype paints us into a corner.
