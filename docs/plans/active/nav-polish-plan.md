# Nav reorder + new homepage with custom tiles

## Context

The current left nav has accumulated drift: Playthroughs (the active-session entry point) sits at the bottom under "Run", while the dashboard — currently a placeholder stats grid behind WIP — occupies the top slot. The user wants the nav rearranged so the most-used items are reachable first, and the "Run" section renamed to "Setup" with Days, Physical Letters, and Settings grouped together as setup-time concerns. Graph View (currently in "Game") belongs with the inspection editor surfaces, since it shows the same letters-by-day data, so it moves into Inspection and shortens to "Graph".

Alongside the nav reorder, there is no real homepage today — `/` redirects to `/dashboard`, and the site title in the nav is static text. The user wants `/` to be a true landing page that each user customizes: a grid of large tiles, one per page, each showing the same icon used in the nav above the page name, with hover affordance. Tile selection and order are per-user and persisted server-side so they sync across devices.

Outcome: faster navigation to active work, a clearer setup-vs-play distinction, and a personalized landing surface every user sees after sign-in.

## Critical files

- `src/components/nav.tsx` — left nav; reorder items, rename Run→Setup, drop inline `NAV_ITEMS`, make site title a link.
- `src/lib/nav-items.ts` (new) — single source of truth for `NAV_ITEMS`, `NAV_SECTIONS`, types, `DEFAULT_TILE_HREFS`.
- `src/app/(authed)/page.tsx` (new) — server-rendered homepage that loads the user's saved tiles.
- `src/components/home/home-tiles.tsx` (new) — client component with view + edit modes.
- `src/app/(authed)/actions.ts` (new) — `setUserHomeTiles` server action.
- `src/app/page.tsx` — delete (the `(authed)/page.tsx` resolves to `/` since route groups don't appear in URLs).
- `src/app/sign-in/actions.ts` — change `?? "/dashboard"` and `safeNext` fallback to `"/"`.
- `src/lib/supabase/middleware.ts` — change auth'd-on-sign-in redirect from `/dashboard` to `/`.
- `src/lib/db/types.ts` — append `UserHomeTiles` row type.
- `supabase/migrations/<timestamp>_user_home_tiles.sql` (new) — table + RLS + updated_at trigger.

## Changes

### 1. Extract nav metadata

Create `src/lib/nav-items.ts` (plain `.ts`, no `"use client"`). Move the existing `NAV_ITEMS` array from `nav.tsx` lines 33–64 into this file along with the `NavIcon` type and `NavSection` union. Also export `NAV_SECTIONS` (the section order array currently inline at `nav.tsx` lines 117–125), `DEFAULT_TILE_HREFS`, and a `getNonWipNavItems()` helper that filters via `WIP_PATHS` from `src/lib/wip-pages.ts`. Lucide-react and `@tabler/icons-react` components import fine in both server and client contexts since they are pure stateless React components.

`nav.tsx` then imports `NAV_ITEMS` and `NAV_SECTIONS` and drops its inline copies. Behavior unchanged.

### 2. Reorder + rename in `NAV_ITEMS`

Final order (one flat array, grouped by section):

```
Game
  /playthroughs        Playthroughs     PlayCircle      (moved from Run)
  /dashboard           Dashboard        Inbox

Sorting
  /sorting/letters     Letters          Mail
  /sorting/rules       Rules            Ruler

Inspection
  /inspection/letters     Letters       IconMailOpened
  /inspection/storylines  Storylines    BookOpen
  /inspection/actions     Actions       IconBolt
  /graph                  Graph         MapIcon         (moved from Game, label "Graph View" → "Graph")

Top of Day
  /top-of-day/morning-reports  Morning Reports  Megaphone

Endings
  /endings/frameworks  Frameworks  ScrollText
  /endings/logic       Logic       Network
  /endings/variables   Variables   Variable

Data
  /citizens  Citizens  Users
  /cities    Cities    MapPin
  /nations   Nations   Flag

Setup    (renamed from "Run")
  /days       Days              CalendarDays  (moved from Game)
  /physical   Physical Letters  Package       (moved from Game)
  /settings   Settings          Settings
```

In `NAV_ITEMS`, also update the `section` union: replace `"Run"` with `"Setup"`. Update `NAV_SECTIONS` to `["Game", "Top of Day", "Sorting", "Inspection", "Endings", "Data", "Setup"]` (matches the existing nav.tsx section render order, with "Setup" replacing "Run"). The new "Inspection" section block now ends with Graph; "Game" shrinks to Playthroughs + Dashboard; "Setup" gains Days + Physical Letters before Settings.

### 3. Site title becomes a link to `/`

In `nav.tsx` lines 185–188, wrap the `<div>` containing "Mail Show" + "Planning tool" in a `<Link href="/">`. Add a hover affordance (`hover:text-foreground` on the title row, focus-visible ring matching other nav links). Keep the two-line layout. Add `onClick={() => setOpen(false)}` so tapping the title closes the narrow-screen drawer even when the pathname doesn't change (the existing `useEffect` close-on-pathname trick at `nav.tsx:130` doesn't fire if you click the title while already on `/`).

### 4. New homepage at `/`

Delete `src/app/page.tsx` (the current `redirect("/dashboard")`). Create `src/app/(authed)/page.tsx` — the `(authed)` route group is URL-transparent, so this resolves to `/`. Critically, both files must not exist simultaneously: `pnpm build` will fail at the route collision. The homepage intentionally renders inside the `(authed)` layout (`src/app/(authed)/layout.tsx` → `AppShell`) and is gated by `src/proxy.ts`, same as every other authed page. Server component:

```ts
// Fetch claims → user.id (createSupabaseServerClient, never the service-role client)
// .from("user_home_tiles").select("tile_hrefs").eq("user_id", id).maybeSingle()
// const saved = data?.tile_hrefs ?? DEFAULT_TILE_HREFS
// Filter saved through Set(NAV_ITEMS hrefs) to drop stale entries (no DB rewrite at render time)
// Render <PageHeader title="Home" /> + <HomeTiles initialHrefs={...} />
```

The client component (`src/components/home/home-tiles.tsx`) owns mode state and renders both views. The full selectable pool is imported directly from `@/lib/nav-items` (all `NAV_ITEMS`, **including WIP**), so the server prop surface is just `initialHrefs: string[]`.

**WIP items are included in the tile pool**: `/playthroughs` and `/dashboard` are currently in `WIP_PATHS` but are still navigable pages — and the whole point of putting Playthroughs at the top of the nav is to make it the most prominent destination, so it must be a pickable tile. WIP tiles render with the same dimmed muted-foreground styling as in the nav (`text-muted-foreground/55`), inheriting the existing "this surface is in progress" affordance.

**View mode**: responsive grid (`grid-cols-2 md:grid-cols-3 lg:grid-cols-4`). Each tile is a `<Link>` styled like the existing `StatCard` in `dashboard/page.tsx` (`rounded-lg border border-border bg-card`, `hover:border-primary/60` for the hover affordance). The icon is rendered at `h-12 w-12` centered above the label. Top-right "Edit" button toggles to edit mode.

**Edit mode**: two regions, no DnD library:

- **Selected** — flat list in current save order. Each row: `[checkbox][icon][label] … [▲][▼]`. Unchecking removes it from Selected and back to Available. Arrows disabled at boundaries.
- **Available** — currently-unchecked items, grouped by section header (matching the nav). Each row: `[checkbox][icon][label]`. Checking appends to the end of Selected.

Save calls `setUserHomeTiles(hrefs)`, then `router.refresh()` and back to view mode. Cancel discards local edits and returns to view mode. Use `useTransition` to disable Save while the action is in-flight. Empty selection is allowed; view mode shows a "No tiles yet — Edit tiles" empty state.

### 5. Server action `setUserHomeTiles`

`src/app/(authed)/actions.ts`, `"use server"`. Uses `createSupabaseServerClient()` (never the service-role client — that bypasses RLS). Resolves the user id via `supabase.auth.getClaims()` (same pattern used in `src/lib/supabase/middleware.ts:37`, which verifies the JWT locally; this is the right call for a Server Action, no need to switch to `getUser()`). **Fail closed**: if `error` is set or `claims?.claims?.sub` is missing/empty, `throw new Error("Not authenticated")` before touching the DB — never let an undefined user id reach the upsert.

Then dedupe the input and whitelist against the full `NAV_ITEMS` href set (security boundary — RLS controls the row, but not its contents; the whitelist is what stops a forged client from saving `"/admin"`). Soft-cap at the total nav-item count. Upsert on `user_id` conflict. Call `revalidatePath("/")`.

`auth.uid()` inside the RLS policy and `claims?.claims?.sub` in the action both resolve to the same `auth.users.id` UUID when using the standard publishable-key server client, so the row the action writes is exactly the row the user's session can read/update.

### 6. Supabase table + RLS

Create via `supabase migration new user_home_tiles` to get the timestamp prefix. Make it idempotent so re-applying is safe:

```sql
-- Depends on public.set_updated_at() defined in 0001_init.sql:13.

create table if not exists public.user_home_tiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tile_hrefs text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create or replace trigger user_home_tiles_set_updated_at
  before update on public.user_home_tiles
  for each row execute function public.set_updated_at();

alter table public.user_home_tiles enable row level security;

-- Postgres has no `create policy if not exists`, so drop-then-create makes the migration safe to re-run.
drop policy if exists "user_home_tiles_select_own" on public.user_home_tiles;
create policy "user_home_tiles_select_own" on public.user_home_tiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "user_home_tiles_insert_own" on public.user_home_tiles;
create policy "user_home_tiles_insert_own" on public.user_home_tiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "user_home_tiles_update_own" on public.user_home_tiles;
create policy "user_home_tiles_update_own" on public.user_home_tiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

No DELETE policy — empty `tile_hrefs = '{}'` covers the "no tiles" case, and `on delete cascade` on the FK handles account deletion. The three policies (SELECT/INSERT/UPDATE) together are exactly what `upsert` needs: INSERT for the first save, UPDATE for subsequent saves, SELECT for reading the saved row on render.

`set_updated_at()` is already defined in `0001_init.sql:13`. Per memory `project_dev_points_at_prod_db.md` and `project_db_migrate_0020_not_idempotent.md`, **apply this migration via the Supabase MCP `apply_migration` tool** rather than `pnpm db:migrate`. The migration file still lives in `supabase/migrations/` so the schema is version-controlled.

Append to `src/lib/db/types.ts`:

```ts
export interface UserHomeTiles {
  user_id: string;
  tile_hrefs: string[];
  updated_at: string;
}
```

### 7. Default tile list

In `src/lib/nav-items.ts`, alongside `NAV_ITEMS`:

```ts
export const DEFAULT_TILE_HREFS: readonly string[] = [
  "/playthroughs",
  "/inspection/storylines",
  "/inspection/letters",
  "/inspection/actions",
  "/graph",
  "/top-of-day/morning-reports",
] as const;
```

Six default destinations covering the prominent entry point (`/playthroughs`, the active session) plus the main editor surfaces. WIP routes are included since the tile pool itself includes WIP items (see §4). Stale defaults are filtered by the same drift logic that handles saved rows.

### 8. Sign-in + middleware redirects

- `src/app/sign-in/actions.ts`: change `?? "/dashboard"` on lines 30, 55, 77 and `safeNext` fallback on line 25 to `"/"`.
- `src/lib/supabase/middleware.ts:58`: change `redirect.pathname = "/dashboard"` to `"/"`.

### 9. Edge cases handled

- **Stale saved href** (route renamed or removed): filtered at render time via the full `NAV_ITEMS` href set so the page never breaks. In addition, opportunistically prune at write time — the server action's whitelist+dedupe already drops unknown hrefs before upserting, so any save naturally cleans the row. No background sweep needed.
- **Zero tiles**: allowed. View mode renders an empty state with an Edit button.
- **No saved row**: server query uses `.maybeSingle()`, falls back to `DEFAULT_TILE_HREFS`. Row materializes on first Save via upsert.
- **Concurrent edits in two tabs**: last-write-wins via upsert. Acceptable.
- **Unauth'd access**: proxy already bounces unknown routes to `/sign-in`; the new authed page sits inside the same group.

## Verification

1. `pnpm typecheck` clean, `pnpm lint` clean, `pnpm build` clean.
2. Apply the migration via Supabase MCP `apply_migration` against the dev/prod DB.
3. Reload `pnpm dev` and confirm:
   - The left nav shows the new order: Game (Playthroughs, Dashboard) → Top of Day → Sorting → Inspection (Letters, Storylines, Actions, Graph) → Endings → Data → Setup (Days, Physical Letters, Settings).
   - Graph nav label reads "Graph", Setup header reads "Setup".
   - Clicking "Mail Show" in the nav navigates to `/`.
4. Signed-in landing flow: sign out, sign back in, land at `/` (not `/dashboard`).
5. Homepage:
   - First load (no saved row) shows the six defaults in a grid; each tile has the same icon as in the nav at `h-12 w-12`; hovering darkens the border.
   - Click Edit → both Selected and Available appear; uncheck one and watch it move to Available; check one to add to Selected end; ▲/▼ reorder; Save persists; reload confirms persistence.
   - Cancel reverts in-memory changes without persisting.
   - Empty selection renders the empty state with a re-entry to Edit.
6. Open a second browser/profile, sign in as a different test user, confirm a separate tile set (RLS isolating rows).
7. Manually update `tile_hrefs` to include a bogus href (e.g. `/totally-fake`) via Supabase MCP, reload `/`, confirm the bogus entry is silently filtered without breaking the page.
