-- Admin-created members complete their own profile (24 Sept 2026).
--
-- An admin adding a member by hand rarely knows their date of birth or gender,
-- and both columns were NOT NULL — so /admin/members/new failed with a bare
-- "Failed to create member" whenever DOB was left blank (it is optional on the
-- form). The same constraint silently broke the Clerk user.created webhook's
-- "no member row yet" insert, which has never set either field.
--
-- Both become nullable. A member with either one missing is sent to
-- /account/onboarding before the portal renders (see needsOnboarding in
-- lib/community.ts), so the under-18 gates never run against an unknown DOB for
-- a member who is actually using the app.
--
-- account_invite_sent_at records the "activate your account" email an admin
-- sends to such a member, and rate-limits re-sends.

ALTER TABLE public.members
  ALTER COLUMN date_of_birth DROP NOT NULL,
  ALTER COLUMN gender DROP NOT NULL;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS account_invite_sent_at timestamptz;

COMMENT ON COLUMN public.members.account_invite_sent_at IS
  'When the admin "activate your account / complete your profile" invite email last went out; gates re-sends.';
