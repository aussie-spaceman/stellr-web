-- 035: Schools hardening — make is_active reliable.
--
-- schools.is_active had no column default, so rows created by registration
-- linking (lib/school-link.ts resolveSchoolId) and the 024 backfill were left
-- NULL. The registration school search filtered `is_active = true`, so it never
-- returned those rows — existing schools didn't appear in search, which pushed
-- registrants into "+ Add new school" and spawned duplicates (e.g. the canonical
-- "Alta High School" vs a freshly-typed "Alta high school Utah").
--
-- resolveSchoolId now sets is_active = true on insert, and the search tolerates
-- NULL during rollout. This adds the default and repairs the legacy NULL rows so
-- the search predicate and the admin Schools list finally agree. Additive + safe.

ALTER TABLE public.schools ALTER COLUMN is_active SET DEFAULT true;

UPDATE public.schools SET is_active = true WHERE is_active IS NULL;
