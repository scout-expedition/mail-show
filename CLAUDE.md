# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This is NOT the Next.js you know

Next 16 has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Specifically: middleware was renamed to **proxy** — `src/proxy.ts` is the file that runs on every request and bounces unauthenticated users to `/sign-in`. Don't recreate `src/middleware.ts`.

## Commands

- `pnpm dev` — Next dev server (Turbopack, root pinned in `next.config.ts`).
- `pnpm typecheck` — `tsc --noEmit`. Run after every substantive change.
- `pnpm lint` — eslint (flat config in `eslint.config.mjs`).
- `pnpm build` — production build.
- `pnpm db:migrate` — applies every `supabase/migrations/*.sql` in lexical order against `DATABASE_URL`, then runs `supabase/seed.sql` if present. Migrations are intentionally minimal: no history table, no rollback. Each is written to be idempotent-friendly (creates types/tables that don't exist), so running the script repeatedly is safe. For one-off changes prefer the Supabase SQL editor or the Supabase MCP and check the resulting SQL into `supabase/migrations/`.

## Architecture

### Auth + routing
- Everything user-facing lives under `src/app/(authed)/...` and renders inside `<AppShell>` (`src/components/app-shell.tsx`) — dark control-room layout with left nav and a sticky variable HUD.
- `src/proxy.ts` (Next 16's renamed middleware) refreshes Supabase session cookies and redirects unauthenticated users.
- Email allow-list lives in `src/lib/auth/allowlist.ts`, fed by `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS` env vars.

### Three Supabase clients
- `src/lib/supabase/server.ts` — cookie-aware server client; use in Server Components and Server Actions.
- `src/lib/supabase/client.ts` — browser client.
- `src/lib/supabase/middleware.ts` — request-scoped client used by `src/proxy.ts` to refresh sessions.

Pick the right one for the surface; mixing them breaks auth.

### Domain model
The schema (Postgres + RLS) is built up across `supabase/migrations/0001_init.sql` … `0012_*.sql`. The hierarchy:

```
storyline → letter group → inspection letter (variants × pieces) → action
                                                                 ↘ 9 typed impact columns
                        ↘ report group → report segment
days × 4 phases (top of day / sorting / inspection / end of day)
sorting letters (full / 1-/2-/3-lookup) → sorting rules (≤3 conditions)
physical letters → SL###### RFID payload
playthroughs → active cursor + variable HUD + per-letter action chooser
endings (madlib frameworks + variables + logic)
nations / cities / citizens (reference data)
```

### Database views generate display IDs
Don't compute these in app code — they come from views and are the truth across the UI:
- `inspection_letters_view.content_id` → `L-W2/b3` (single-letter groups hide the variant suffix; piece is omitted when 0)
- `report_segments_view.report_id` + `effective_day_id` → `R-W2/ii`, day = min(letter delivery_day_override) + 1, falling back to letter_groups.delivery_day_id + 1, and overridden by report_segments.delivery_day_override_id when set
- `sorting_letters_view.content_id` → `S2-09`
- `playthrough_variables` → 9-column impact tally + `combined_national` (excludes Epicenter by design)

Row + view types are hand-maintained in `src/lib/db/types.ts`. Enum values + display labels + the `VALID_OPERATOR_REFERENCES` matrix used by the rule UI all live in `src/lib/db/enums.ts` — that file is the single source of truth for enums.

### Key library modules
- `src/lib/ids.ts` — IL/R/S/SL formatters.
- `src/lib/rules/evaluate.ts` — pure rule evaluator (used by the Phase 3 sim).
- `src/lib/playthrough/variables.ts` — impact tally + label map.
- `src/lib/letter-groups.ts`, `src/lib/graph-overlay.ts`, `src/lib/citizen-id.ts`, `src/lib/color.ts`.

### The two big editor surfaces

**`/inspection/letters` — `LettersWorkspace`** (`src/app/(authed)/inspection/letters/workspace.tsx`)
A 5-panel horizontal slide: storylines list | group info+letters | letter fields | actions | segment. Wrapper width is `250%`, each panel is `w-1/5`, advance with `-translate-x-[20%]` per step. Don't break the slide math. Slot 1 swaps between storyline inspector / group panel / empty state based on selection. URL params `?group` / `?letter` / `?report` deep-link.

**`/graph` — narrative graph** (`src/app/(authed)/graph/`)
React Flow (`@xyflow/react` v12) view of letter groups → next-letter actions, laid out by storyline column × day row. `graph-surface.tsx` embeds `LettersWorkspace` in `forceNarrow` controlled-selection mode for inline inspection. Drag-and-drop re-plumbing dispatches server actions in `inspection/letters/actions.ts` (`moveLetterGroupToDay`, `moveLetterToGroup`, `moveReportSegmentToDay`, `setActionNextLetter`, `batchMoveToDay`); xyflow re-renders from props after `revalidatePath`, so invalid drops snap back automatically. Phase status is tracked in `docs/narrative-graph-plan.md`.

### Plan files
Active and historical work plans live under `docs/`:
- `docs/inspection-letters-plan.md` — closed; status log of the letters workspace work.
- `docs/narrative-graph-plan.md` — open; phases 1–3 + 5 shipped, phases 4 + 6 remaining.

Before starting feature work in either area, read the corresponding plan first.

## Conventions

- Server Actions live next to the page that calls them (e.g. `src/app/(authed)/inspection/letters/actions.ts`). When an action mutates data that another page reads, `revalidatePath()` both routes (e.g. `/inspection/letters` and `/graph`).
- Shared confirm/discard flows go through `useConfirm()` (`src/components/confirm-dialog.tsx`) and `useUnsavedDialog()` (`src/components/unsaved-dialog.tsx`) — don't reach for native `confirm()`.
- Forms use react-hook-form + zod when validation is non-trivial, otherwise plain controlled state with the `auto-save-form` helper.

## Deployment

Hosted on Vercel under the `coreylubos-projects` team. The repo is connected to a Vercel project that deploys **only** the `main` branch — PR preview deployments are disabled via `vercel.json` (`git.deploymentEnabled: { "main": true }`). Merges to `main` build + deploy to production automatically; PRs do nothing on the Vercel side. To temporarily preview a branch, add it to `deploymentEnabled` and push, or use the Redeploy button in the Vercel dashboard.

Env vars live in the Vercel project settings (not in the repo). The proxy + Supabase clients read `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. Membership is governed by Supabase `auth.users` directly (no allowlist) — invites/deletes happen at `/settings`.

Auth emails (invite, magic link, password reset) go through **Resend** SMTP — configured in the Supabase dashboard under Auth → SMTP Settings, not in code. The sender currently uses Resend's onboarding domain (`onboarding@resend.dev`); swap to a custom sending domain in a later branch. Setup checklist in `docs/auth-email-reset-plan.md`.
