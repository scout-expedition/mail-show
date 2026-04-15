# Mail Show

Authoring + production tool for the mail-sorting immersive theatre game.

Phase 1 covers the full data model and editing UIs:

- Days × four phases (top of day / sorting / inspection / end of day)
- Storylines → letter groups → inspection letters → actions (with 9 typed
  variable-impact columns)
- Auto-linked report groups + report segments with greying logic on the day
  view
- Sorting letters with full / 1-/2-/3-lookup address blocks
- Sorting rules with up to 3 conditions (locked target enum) and a live
  condition builder
- Physical letters with generated `SL######` RFID payloads
- Reference data: nations, cities, citizens
- Multiple named playthroughs with active-cursor + variable HUD + per-letter
  action chooser
- Narrative graph (React Flow) of letter groups → next-letter actions

Plan file: `~/.claude/plans/quiet-snuggling-boot.md`.

## Stack

- Next.js 16 (App Router, Server Components + Server Actions), TypeScript
- Tailwind CSS 4 + bespoke dark-mode tokens for the control room
- Supabase: Postgres + Auth (magic links, email allow-list) + RLS
- React Flow (`@xyflow/react`) for the narrative graph
- React-hook-form / zod for form validation when needed

## Setup

1. **Install deps**
   ```bash
   pnpm install
   ```
2. **Create `.env.local`** from `.env.local.example` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` — `https://qleuihyqfpnectqcqagx.supabase.co`
     (project `mail-show` in org *Scout Expedition Co*).
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — anon key from
     [project API settings](https://supabase.com/dashboard/project/qleuihyqfpnectqcqagx/settings/api).
   - `SUPABASE_SERVICE_ROLE_KEY` — service-role key, server-only.
   - `DATABASE_URL` —
     `postgresql://postgres:<password>@db.qleuihyqfpnectqcqagx.supabase.co:5432/postgres`
   - `ALLOWED_EMAILS` — comma-separated list of emails that may sign in.
   - `ALLOWED_EMAIL_DOMAINS` — comma-separated list (optional).
3. **Apply schema migration** (one-time):
   ```bash
   pnpm db:migrate
   ```
   This applies `supabase/migrations/0001_init.sql` and seeds the five nations.
   Alternative: paste the SQL into the Supabase SQL editor.
4. **Dev server**
   ```bash
   pnpm dev
   ```
   The `proxy.ts` (Next 16's renamed middleware) bounces unauthenticated
   users to `/sign-in`.
5. **Typecheck / build**
   ```bash
   pnpm typecheck
   pnpm build
   ```

## Architecture

- `src/app/(authed)/...` — all editor pages live behind the `AppShell`
  (`src/components/app-shell.tsx`) which renders the dark layout, left nav,
  and sticky top bar with the variable HUD.
- `src/lib/supabase/{server,client,middleware}.ts` — three Supabase clients
  (server cookie-aware, browser, request middleware that refreshes session
  cookies).
- `src/lib/db/enums.ts` — single source of truth for enum values + their
  display labels and the `VALID_OPERATOR_REFERENCES` matrix the rule UI uses.
- `src/lib/db/types.ts` — hand-maintained row + view types.
- `src/lib/ids.ts` — IL/R/S/SL formatters.
- `src/lib/rules/evaluate.ts` — pure rule evaluator (used by Phase 3 sim).
- `src/lib/playthrough/variables.ts` — 9-column impact tally + label map.

Database views do the heavy lifting:

- `inspection_letters_view.content_id` → `IL-W2/b3` etc.
- `report_segments_view.report_id` + `effective_day_id` →
  `R-W2/ii` and triggering-letter day + 1.
- `sorting_letters_view.content_id` → `S2-09`.
- `playthrough_variables` → tallied 9 impact columns + `combined_national`
  (excludes Epicenter per the plan).

## Verification (manual smoke test)

After `pnpm db:migrate` + `pnpm dev` and signing in:

1. **Reference data** — Nations page should already have 5 seeded rows.
   Add cities and citizens.
2. **Storyline + group** — Create storyline `W` ("Unity Day"). Inside,
   add letter group "Opening" sequence 2. Confirm a matching report group
   appeared (visible on the group detail page).
3. **Inspection letter** — Inside the group, add letter variant `b` piece 3.
   Confirm `IL-W2/b3` appears as the badge. Default Deliver + Flag actions
   are seeded.
4. **Report segment** — Add variant `ii`, confirm `R-W2/ii`.
5. **Days** — Create days D1 + D2. Set the group's delivery day to D1.
   Open D2 → Top of Day; the segment should show up under the group.
6. **Sorting letter** — Create one on D2 with sort_id 9, confirm `S2-09`.
7. **Physical letter** — Create one pointing at the new sorting letter,
   confirm the `SL######` RFID payload renders.
8. **Rule** — Create RR-A. Add condition: target=`recipient_nation`,
   operator=`equals`, reference=`Pelico`. Save.
9. **Playthrough** — Create "Test run", make active. Pick the Deliver action
   on `IL-W2/b3`. The HUD totals should update; on D2 → Top of Day, only the
   chosen segment is highlighted, others greyed.
10. **Graph** — `/graph` shows the letter groups laid out by storyline ×
    sequence, with action-colored edges between consecutive groups.

## Phases 2-4 (out of scope here)

- Phase 2: realtime presence + collaborative editing (Supabase Realtime).
- Phase 3: text-only digital game simulator.
- Phase 4: Mac desktop app + OSC + QLab integration.
