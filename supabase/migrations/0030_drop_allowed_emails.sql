-- Drop the allowed_emails bootstrap table.
--
-- Membership is now governed by Supabase auth.users directly: admins invite
-- new users from /settings via auth.admin.inviteUserByEmail, and unknown
-- emails can't self-create accounts because sign-in passes
-- shouldCreateUser:false to signInWithOtp.
--
-- Idempotent-friendly per project convention.

drop table if exists public.allowed_emails;
