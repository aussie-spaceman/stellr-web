-- Migration 037 — persist a group's DECLARED size on the registration.
--
-- Background: a teacher / student-manager nominates a group of N people up front,
-- but may only have *some* of their details at registration time (partial
-- "add them now"). The rest are completed later via the forwardable join link or
-- the pre-filled Google Sheet. To drive that flow we need to know the declared
-- size — but adult_count / student_count were only ever passed to the group route
-- and never stored, so the join route read reg.adult_count as undefined and fell
-- back to a hard-coded 1 + 2 = 3 (wrong for every real group).
--
-- These columns store the ABSOLUTE, role-normalised totals so the math downstream
-- is role-agnostic: adult_count + student_count == total declared participants for
-- BOTH a teacher group (teacher counts themselves) and a student-manager group
-- (the SM is counted as a student). With these:
--   • the join link / portal can cap at the declared size and show "Y remaining"
--   • the confirmation page / email can show the real remaining count
--   • the Google Sheet can size its blank rows to just the remainder
--
-- Nullable + no backfill: older registrations keep NULL and every reader falls
-- back to its previous behaviour (no cap, count from participants), so this is
-- safe to deploy before or after the matching app code.

BEGIN;

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS adult_count integer,
  ADD COLUMN IF NOT EXISTS student_count integer;

COMMIT;
