-- keep_alive is written only by the GitHub Actions heartbeat using the service
-- role key, which bypasses RLS. Enabling RLS with no policies denies anon and
-- authenticated entirely and clears the rls_disabled_in_public advisor.
alter table public.keep_alive enable row level security;

revoke all on table public.keep_alive from anon, authenticated;
