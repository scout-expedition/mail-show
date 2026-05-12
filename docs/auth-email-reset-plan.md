# Resend SMTP + password reset flow

## Context

After auth-users (#18, now on `main`), two gaps remain that this branch closes:

1. **Email delivery is unreliable.** Supabase's built-in sender rate-limits aggressively and is officially "not for production." We hit the cap while testing invites; further auth emails (magic links, invites, future password resets) need a real SMTP path. Tracked as #20.
2. **No password recovery.** If a user forgets their password they're stuck — `/sign-in` has no "Forgot password?" link and `/settings` only offers Delete + Invite. The only escape is delete + re-invite. Tracked as #21.

Confirmed scope decisions:
- **SMTP provider**: Resend, using the `resend.dev` onboarding domain (zero DNS work). Switch to a custom domain in a later branch.
- **Admin trigger**: include a "Send password reset" button per row in `/settings`, alongside Delete.

## High-level changes

1. Configure Supabase → Auth → SMTP Settings to route through Resend (dashboard, documented but not code).
2. Add a "Forgot password?" surface on `/sign-in` that fires `auth.resetPasswordForEmail`.
3. Add "Send password reset" buttons per row on `/settings`.
4. Reuse `/auth/set-password` as the landing page for both flows — it already accepts any authed session.
5. Tests: extend `tests/e2e/auth-users.spec.ts` with two reset-flow specs.

No new pages required — both flows land on the existing `/auth/set-password`.

## File-by-file plan

### Sign-in surface (user-initiated reset)

- **`src/app/sign-in/sign-in-form.tsx`** — Add a third small submit button styled as a link below the magic-link button: "Forgot your password?". Uses `formAction={requestPasswordReset}`. Reuses the email already typed in the form.
- **`src/app/sign-in/actions.ts`** — Add `requestPasswordReset(formData)`:
  - Validate email with the existing `validateEmail()`.
  - Build `redirectTo = ${origin}/auth/callback?next=/auth/set-password`.
  - Call `supabase.auth.resetPasswordForEmail(email, { redirectTo })`.
  - Treat any error as success in the UI (generic "if that email is registered, a reset link is on its way") to avoid email enumeration.
  - Redirect to `/sign-in?reset=1` for the success banner.
- **`src/app/sign-in/page.tsx`** — Add `reset` to the searchParams shape; pass it to `<SignInForm>`.
- **`src/app/sign-in/sign-in-form.tsx`** (success banner) — When `reset=1`, render the same green banner shape as `sent=1`, with the generic message.

### Settings surface (admin-triggered reset)

- **`src/app/(authed)/settings/users-section.tsx`** — Add a "Send reset" button per row, to the left of Delete. Reuses `useTransition`. Shows inline success message ("Reset email sent to X").
- **`src/app/(authed)/settings/actions.ts`** — Add `adminResetPassword(formData)`:
  - Read `userId`, look up the user's email via `service.auth.admin.listUsers` (we already have the row, but the action should be self-sufficient).
  - Actually simpler: pass the email directly from the row (it's already in the client component).
  - Call `service.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo: ... } })`. Supabase auto-sends if SMTP is configured.
  - On error throw (consistent with `deleteUser`).
  - `revalidatePath('/settings')`.

### Auth callback + set-password

No changes. The reset link includes `?code=...`; our existing `/auth/callback` handler exchanges it and redirects to `next=/auth/set-password`. The set-password page is already protected and lets any authed user update their password — works for both invites and resets unchanged.

### Tests

- **`tests/e2e/auth-users.spec.ts`** — Add two specs:
  1. **User-initiated reset**: anonymous browser → `/sign-in` → "Forgot password?" → assert the generic banner. Use `admin.generateLink({ type: 'recovery' })` to mint the equivalent link programmatically, follow it via the existing `signInAs`-style helper, set a new password on `/auth/set-password`, sign out, sign back in with the new password.
  2. **Admin-initiated reset**: authed admin on `/settings` → click "Send reset" on a target user's row → assert success message. Verify a recovery link was generated for that user (via `admin.generateLink` introspection on the same user — it should regenerate).
- Cleanup: as before, unique emails per test + `deleteUserByEmail` in `finally`.

### Resend SMTP setup (dashboard-only, documented)

No code. Document the steps in `docs/auth-email-reset-plan.md` (this file, in a final "Resend setup" section below) and add a one-paragraph note to `CLAUDE.md` under Deployment so future-you remembers where Supabase Auth gets its SMTP from.

Steps the operator follows:
1. Sign up at resend.com (free tier).
2. Generate an API key.
3. In Supabase dashboard → Auth → SMTP Settings:
   - **Enable Custom SMTP**: on
   - **Sender email**: `onboarding@resend.dev`
   - **Sender name**: `Mail Show`
   - **Host**: `smtp.resend.com`
   - **Port**: `587`
   - **Minimum interval**: 60 seconds (Resend free-tier safe; tune later)
   - **Username**: `resend`
   - **Password**: the API key from step 2
4. Save. Trigger an invite from `/settings` to test — email should arrive via Resend.
5. (Followup) Move to a custom domain when ready; update sender email and verify DKIM/SPF on the new domain.

## Execution order (parallel-friendly)

### Phase 1 — server actions + helper changes (parallel)
- Add `requestPasswordReset` to `sign-in/actions.ts`.
- Add `adminResetPassword` to `(authed)/settings/actions.ts`.

### Phase 2 — UI surfaces (parallel)
- `sign-in/sign-in-form.tsx`: third "Forgot your password?" button + `reset=1` banner.
- `sign-in/page.tsx`: extend searchParams shape.
- `(authed)/settings/users-section.tsx`: "Send reset" button + inline message.

### Phase 3 — tests (parallel)
- Two new specs in `tests/e2e/auth-users.spec.ts`.

### Phase 4 — verify
- `pnpm typecheck`, `pnpm lint`, `pnpm vitest run src/lib/auth` in parallel.
- `pnpm test:e2e -g auth-users` (requires `supabase start`).
- Manual: configure Resend SMTP in dashboard (per checklist above), trigger one invite + one reset from prod, confirm both emails arrive via Resend.

## Files touched

Modified: `src/app/sign-in/actions.ts`, `src/app/sign-in/sign-in-form.tsx`, `src/app/sign-in/page.tsx`, `src/app/(authed)/settings/actions.ts`, `src/app/(authed)/settings/users-section.tsx`, `tests/e2e/auth-users.spec.ts`, `CLAUDE.md` (one paragraph on SMTP)

Added: (none — reusing `/auth/set-password`)

Deleted: (none)
