-- A self sign-up's age is not known until onboarding (decision 24, 3 Nov 2026).
--
-- The Clerk user.created webhook made a members row for every self sign-up
-- with age_bracket 'adult', before anyone had asked the person's date of
-- birth: the person signing up may be a child, and 'adult' told the age gates
-- the opposite. The webhook now stores only the email and the Clerk id, with
-- no name, no photo and no age bracket, and onboarding fills the rest by age
-- band (app/api/webhooks/clerk, app/api/members/onboarding).
--
-- So age_bracket becomes nullable: NULL means "not known yet". Every reader
-- already treats a missing date of birth as a minor (lib/age isMinorOn,
-- lib/community memberIsMinor, lib/no-ads isStudentForAds), and a row without
-- a date of birth is sent to /account/onboarding before any member page
-- renders (needsOnboarding, lib/community). Existing rows are unchanged.

ALTER TABLE public.members
  ALTER COLUMN age_bracket DROP NOT NULL;

COMMENT ON COLUMN public.members.age_bracket IS
  'high_school / college / adult, set at onboarding or registration. NULL: not known yet (a self sign-up that has not onboarded); treated as a minor.';
