-- Migration 030: Consolidate member ethnicity/dietary onto the join tables
--
-- Migration 028 added ethnicity/dietary_requirements text[] columns to
-- `members` (copying the participants table's shape) — but member ethnicity
-- and dietary data already lived in the member_ethnicities/member_allergies
-- join tables (005), which is what /account, the admin member editor, and both
-- profile PATCH APIs read and write. Result: the same split-brain as the
-- emergency-contact columns fixed in 029 — registrations saved selections into
-- columns the account page never showed.
--
-- The join tables win: the register routes now sync selections into them via
-- lib/member-profile-options.ts (option names ARE the registration form's
-- display strings) and lib/registration-prefill.ts reads them back. This
-- migration backfills values captured in the text[] columns and drops them.
-- Participants keep their own ethnicity/dietary_requirements text[] columns —
-- those are the per-event record, not the member profile.
--
-- ⚠️ ORDER OF OPERATIONS: deploy the code change BEFORE running this migration.
-- Code still writing the text[] columns will fail its member upsert once they
-- are gone (non-fatal, but the member profile update would be lost).

-- ─── Live-DB drift repair (verified 2026-06-12) ───────────────────────────
-- The live member_ethnicities/member_allergies tables carry legacy NOT NULL
-- ethnicity_id/allergy_id columns (pre-005 schema) alongside 005's
-- ethnicity_option_id/allergy_option_id. Consequences in production:
--   1. every app insert (account page, admin editor) violates the legacy
--      NOT NULL → both join tables are EMPTY; the PATCH routes delete first
--      and discard the insert error, so saves silently wiped selections;
--   2. the duplicate FKs make PostgREST nested embeds ambiguous (PGRST201).
-- Dropping the legacy columns (and their FKs with them) fixes both. The
-- tables are empty, so nothing is lost.
ALTER TABLE public.member_ethnicities
  DROP COLUMN IF EXISTS ethnicity_id;
ALTER TABLE public.member_allergies
  DROP COLUMN IF EXISTS allergy_id;

-- The registration form offers Halal and Kosher; the 005 seed list never had
-- them, so those selections would not resolve to an option row.
INSERT INTO public.allergy_options (name) VALUES
  ('Halal'),
  ('Kosher')
ON CONFLICT (name) DO NOTHING;

-- Backfill — text[] values were written by registrations after 028 went live,
-- so where present they are newer than the join rows (same newer-wins rule as
-- 029). Replace selections only for members whose text[] resolves to at least
-- one known option; matching is trimmed + case-insensitive on the option name.
DELETE FROM public.member_ethnicities me
WHERE EXISTS (
  SELECT 1
  FROM public.members m
  CROSS JOIN LATERAL unnest(m.ethnicity) AS n(name)
  JOIN public.ethnicity_options eo ON lower(trim(eo.name)) = lower(trim(n.name))
  WHERE m.id = me.member_id
);

INSERT INTO public.member_ethnicities (member_id, ethnicity_option_id)
SELECT DISTINCT m.id, eo.id
FROM public.members m
CROSS JOIN LATERAL unnest(m.ethnicity) AS n(name)
JOIN public.ethnicity_options eo ON lower(trim(eo.name)) = lower(trim(n.name))
ON CONFLICT (member_id, ethnicity_option_id) DO NOTHING;

DELETE FROM public.member_allergies ma
WHERE EXISTS (
  SELECT 1
  FROM public.members m
  CROSS JOIN LATERAL unnest(m.dietary_requirements) AS n(name)
  JOIN public.allergy_options ao ON lower(trim(ao.name)) = lower(trim(n.name))
  WHERE m.id = ma.member_id
);

INSERT INTO public.member_allergies (member_id, allergy_option_id)
SELECT DISTINCT m.id, ao.id
FROM public.members m
CROSS JOIN LATERAL unnest(m.dietary_requirements) AS n(name)
JOIN public.allergy_options ao ON lower(trim(ao.name)) = lower(trim(n.name))
ON CONFLICT (member_id, allergy_option_id) DO NOTHING;

ALTER TABLE public.members
  DROP COLUMN IF EXISTS ethnicity,
  DROP COLUMN IF EXISTS dietary_requirements;
