# Replace email-allowlist auth with real user management

## Context

Today, sign-in works via Supabase magic link, gated by an `allowed_emails` table + `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS` env vars. The `/settings` page manages that allowlist. The mental model is "anyone whose email is on the list can self-create an account by hitting sign-in." There is no password method, and the `auth.users` table is incidental.

We want to invert this: Supabase `auth.users` becomes the **single** source of truth for who has access. Admins explicitly invite users from the Settings page (sending a Supabase invite email that lets the invitee set a password). Users can sign in with **password OR magic link**. There is no public sign-up flow. Admins can delete users from the same Settings page.

Decisions confirmed with the user:
- **Invite**: Supabase invite link → set-password page → signed in.
- **Sign-in UX**: Email+password form, with a secondary "Send magic link" button on the same form (fallback for forgotten passwords / first-time invitees who haven't set one).
- **Settings access**: any signed-in user (no roles).
- **Old allowlist**: drop the `allowed_emails` table and remove env-var consumers. `signInWithOtp({ shouldCreateUser: false })` prevents unknown emails from creating accounts via magic link.

## High-level changes

1. Sign-in form gains a password field + "Send magic link" secondary button.
2. New `/auth/set-password` page where invitees land after clicking the email link.
3. Settings page replaces "Allowed emails / domains" with **"Users"**: list from `auth.admin.listUsers()`, invite form, delete button.
4. Allowlist module + env-var enforcement deleted. Callback no longer cross-checks an allowlist.
5. Migration drops `public.allowed_emails`.
6. Tests: E2E specs for the new auth flows + unit tests for pure validation helpers.

## File-by-file plan

### Auth flow

- **`src/app/sign-in/sign-in-form.tsx`** — Add password input. Two submit buttons: "Sign in" (primary, requires both fields, calls `signInWithPassword`) and "Send magic link" (secondary, ignores password, calls `signInWithMagicLink`). Keep existing `sent` / `error` inline-message pattern.
- **`src/app/sign-in/actions.ts`** —
  - Rewrite `signInWithMagicLink`: remove `isEmailAllowed()` check; pass `{ shouldCreateUser: false }` to `supabase.auth.signInWithOtp`. If Supabase responds that the user doesn't exist, surface a generic "If that email is registered, a link has been sent." message (avoid email-enumeration leak).
  - Add `signInWithPassword(formData)`: validates email + password non-empty; calls `supabase.auth.signInWithPassword`. On success returns `{ ok: true }` and lets the client `router.push(next)`. On failure returns `{ error: "Invalid email or password" }` (generic; don't disambiguate).
- **`src/app/auth/callback/route.ts`** — Drop the `isEmailAllowed()` block (lines 26–34). Keep the code-exchange + `next` redirect. The invite call sets `redirectTo` with `?next=/auth/set-password`, so the callback routes invitees there naturally; magic-link sign-ins continue to `next=/dashboard` (or wherever they came from).
- **`src/app/auth/set-password/page.tsx`** (NEW) — Minimal layout (mirror `/sign-in`). Client form with two password fields ("New password" / "Confirm"). Submits to a server action that calls `supabase.auth.updateUser({ password })`, then `redirect("/dashboard")`. Protected by the proxy (only authed users land here; invitees are authed after callback). If an already-authed user with a password lands here, just let them set a new one — no special-case.
- **`src/app/auth/set-password/actions.ts`** (NEW) — `setPassword(formData)` server action. Validate length (≥ 8) + match between the two fields. Call `supabase.auth.updateUser({ password })`. Return error inline or `redirect`.

### Settings page

- **`src/app/(authed)/settings/page.tsx`** — Replace "Allow-list" sections with a single "Users" section. Server component fetches via service-role client: `serviceClient.auth.admin.listUsers({ perPage: 200 })`. Render a table: Email | Last sign-in | Created | Actions (Delete). Keep the existing "Signed in as / Sign out" block at top. Pass current user id into the row component to disable the delete button for the row matching it.
- **`src/app/(authed)/settings/users-section.tsx`** (NEW client component) — Mirrors the cities-editor pattern (`src/app/(authed)/cities/cities-editor.tsx`): `useTransition` + `useConfirm()` for delete. "Invite by email" `<form action={inviteUser}>` at the top. Inline success message ("Invite sent to X") and error message after server action completes.
- **`src/app/(authed)/settings/actions.ts`** — Replace `addAllowlistEntry` / `removeAllowlistEntry` with:
  - `inviteUser(formData)`: trim+validate email; `serviceClient.auth.admin.inviteUserByEmail(email, { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback?next=/auth/set-password` })`. `revalidatePath('/settings')`.
  - `deleteUser(formData)`: read `userId`; refuse if it equals the current user's id (return error); `serviceClient.auth.admin.deleteUser(userId)`; `revalidatePath('/settings')`.

### Allowlist removal

- **DELETE** `src/lib/auth/allowlist.ts`.
- Remove any other imports — only call sites are `sign-in/actions.ts` and `auth/callback/route.ts`, both rewritten above.
- **`supabase/migrations/0030_drop_allowed_emails.sql`** (NEW) — `DROP TABLE IF EXISTS public.allowed_emails;` (idempotent-friendly, per CLAUDE.md convention).
- **`.env.local.example`** — remove `ALLOWED_EMAILS` and `ALLOWED_EMAIL_DOMAINS` lines (and any inline docs). Add `NEXT_PUBLIC_SITE_URL` for invite redirect.

### Wiring / misc

- **`src/lib/supabase/server.ts`** — no change; `createSupabaseServiceClient()` is already what the new actions need.
- **`src/proxy.ts` / `src/lib/supabase/middleware.ts`** — no change. The existing public-path list (`/sign-in`, `/auth/callback`, `/_next/*`, `/favicon.ico`) is correct; `/auth/set-password` is intentionally protected because invitees are authed by the time they land there.

### Tests

- **`src/lib/auth/validation.ts`** (NEW) — pure helpers, no Supabase. Exports:
  - `validateEmail(value: string): { ok: true; email: string } | { ok: false; error: string }` — trims, checks non-empty + a permissive regex, lower-cases.
  - `validatePassword(password: string, confirm: string): { ok: true } | { ok: false; error: string }` — length ≥ 8 + exact match.
  - `canDeleteUser(currentUserId: string, targetUserId: string): boolean` — `false` when ids match.
  Each new server action uses these instead of inline checks.
- **`src/lib/auth/validation.test.ts`** (NEW) — Vitest unit tests covering each helper's happy + error cases (~6–10 tiny assertions).
- **`tests/e2e/auth-users.spec.ts`** (NEW) — Playwright specs. Follow the existing E2E conventions (`allowedDevOrigins=127.0.0.1`, storageState setup). Five flows:
  1. Password sign-in happy path → lands on `/dashboard`.
  2. Password failure → generic "Invalid email or password" message shown; URL stays on `/sign-in`.
  3. Invite flow → from `/settings`, submit a new email, intercept the Supabase invite email (or call the admin API directly to mint an invite URL), follow the link → land on `/auth/set-password` → submit password → land on `/dashboard`.
  4. Delete user from `/settings` → row disappears, deleted user's session redirected to `/sign-in` on next request.
  5. Self-delete blocked → button disabled for the current user's row; server action also rejects if forced.
  Test fixtures: use a dedicated test user created via the service-role client in test setup, torn down in teardown. Don't pollute the real `auth.users`.

End-to-end, by hand against a local Supabase:

1. `pnpm db:migrate` — confirm the drop migration runs cleanly twice (idempotency).
2. Sign in with an existing user via password → lands on `/dashboard`.
3. Sign in with an existing user via "Send magic link" → email arrives → click → `/dashboard`.
4. Sign in attempt with an **unknown** email + magic link → no email sent; UI shows generic "if that email is registered…" message (verify in Supabase dashboard that no user was created).
5. From `/settings`, invite a brand-new email → Supabase invite email arrives → click link → land on `/auth/set-password` → set password → redirected to `/dashboard`.
6. Sign out, sign back in with the new credentials.
7. From `/settings`, delete the new user → confirm dialog → row disappears. That user's saved session is invalidated; their next request bounces to `/sign-in`.
8. Try to delete yourself → button disabled (and server action rejects if forced).
9. `pnpm typecheck` and `pnpm lint` clean.

## Files touched

Modified: `src/app/sign-in/sign-in-form.tsx`, `src/app/sign-in/actions.ts`, `src/app/auth/callback/route.ts`, `src/app/(authed)/settings/page.tsx`, `src/app/(authed)/settings/actions.ts`, `.env.local.example`

Added: `src/app/auth/set-password/page.tsx`, `src/app/auth/set-password/actions.ts`, `src/app/(authed)/settings/users-section.tsx`, `supabase/migrations/0030_drop_allowed_emails.sql`, `src/lib/auth/validation.ts`, `src/lib/auth/validation.test.ts`, `tests/e2e/auth-users.spec.ts`

Deleted: `src/lib/auth/allowlist.ts`

## Execution order (parallel-friendly)

Each phase below batches changes that have **no dependencies on each other** — they can be written in a single round of parallel `Write` / `Edit` tool calls. Phases run sequentially because each one depends on something the previous one introduced.

### Phase 1 — foundation (parallel, 4 files)

These don't depend on anything else:
- **NEW** `supabase/migrations/0030_drop_allowed_emails.sql` — `DROP TABLE IF EXISTS public.allowed_emails;`.
- **EDIT** `.env.local.example` — remove `ALLOWED_EMAILS` + `ALLOWED_EMAIL_DOMAINS`; add `NEXT_PUBLIC_SITE_URL`.
- **NEW** `src/lib/auth/validation.ts` — pure helpers (`validateEmail`, `validatePassword`, `canDeleteUser`).
- **EDIT** `src/app/auth/callback/route.ts` — strip the `isEmailAllowed()` block; keep code-exchange + `next` redirect.

### Phase 2 — server actions + unit tests (parallel, 4 files)

Depend on Phase 1's `validation.ts`:
- **NEW** `src/lib/auth/validation.test.ts` — Vitest covering the three helpers.
- **REWRITE** `src/app/sign-in/actions.ts` — drop allowlist import; add `signInWithPassword`; magic-link uses `shouldCreateUser: false`.
- **NEW** `src/app/auth/set-password/actions.ts` — `setPassword(formData)` via `auth.updateUser`.
- **REWRITE** `src/app/(authed)/settings/actions.ts` — replace allowlist actions with `inviteUser` + `deleteUser`.

### Phase 3 — UI surfaces (parallel, then one dependent edit)

Depend on Phase 2's action signatures:
- **EDIT** `src/app/sign-in/sign-in-form.tsx` — password field + dual buttons.
- **NEW** `src/app/auth/set-password/page.tsx` — minimal page + form.
- **NEW** `src/app/(authed)/settings/users-section.tsx` — client list with invite form + delete button.

After those land, in a second sub-step (depends on `users-section.tsx`):
- **REWRITE** `src/app/(authed)/settings/page.tsx` — server fetch via `auth.admin.listUsers()`, render the new section.

### Phase 4 — cleanup + E2E (parallel, 2 items)

Depend on Phase 1–3 having removed every allowlist import:
- **DELETE** `src/lib/auth/allowlist.ts`.
- **NEW** `tests/e2e/auth-users.spec.ts` — five flows above.

### Phase 5 — verify (parallel where safe)

- `pnpm db:migrate` (apply drop migration).
- `pnpm typecheck` + `pnpm lint` + `pnpm vitest run src/lib/auth/validation.test.ts` — all three in parallel.
- `pnpm playwright test tests/e2e/auth-users.spec.ts` (sequential, after the others pass).
- Manual sanity: walk steps 1–8 from the **Verification** section above.

### Notes on parallel execution

- All "parallel" calls in this plan are single-turn batched `Write` / `Edit` / `Bash` calls in the main conversation, not multi-agent dispatch. Dispatching sub-agents to write code in parallel risks divergent decisions on shared types (action return shapes, validation helper API), so I'll keep all writes in one turn each.
- Sub-agents are reserved for read-only verification passes (e.g. "is anything else importing the deleted allowlist module?").
