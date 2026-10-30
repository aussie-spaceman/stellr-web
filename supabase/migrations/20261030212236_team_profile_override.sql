-- Team profile override (30 Oct 2026): staff can let Auto-Assign place a
-- student who hasn't submitted a team profile (lib/team-profile/override.ts).
--
-- Until now Auto-Assign placed only students with a submitted profile and left
-- everyone else unassigned for staff to place by hand. An overridden student is
-- balanced on what the roster already knows (age, school, experience, gender,
-- ethnicity) and shows "Overridden" in the Team profiles panel. They still get
-- the team profile email and reminders; once they submit, Submitted replaces
-- Overridden and the next Auto-Assign uses their answers.
--
-- Kept on the participant (one student, one event) rather than team_profiles:
-- a student still waiting on permission forms has no team_profiles row yet.

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS team_profile_overridden_at      timestamptz,
  -- The staff member's Clerk user id and display name (name, else email).
  ADD COLUMN IF NOT EXISTS team_profile_overridden_by      text,
  ADD COLUMN IF NOT EXISTS team_profile_overridden_by_name text;

COMMENT ON COLUMN public.participants.team_profile_overridden_at IS
  'Set when staff let Auto-Assign place this student without a submitted team profile; null otherwise.';
