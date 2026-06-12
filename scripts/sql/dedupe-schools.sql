-- One-time cleanup: merge duplicate school rows (e.g. "Alta High School" vs the
-- system-generated "Alta high school Utah").
--
-- Run AFTER migration 035 (which repairs is_active). This is NOT an automatic
-- migration — review STEP 1 output and run STEP 2 once per duplicate pair so you
-- stay in control of which row survives.
--
-- Only `member_schools` references schools.id; registrations/participants store
-- the school as free text, so nothing else needs re-pointing.

-- ── STEP 1 — find duplicate schools (same name ignoring case / whitespace) ──
-- Review the output: pick the row to KEEP (the canonical one) and the row(s) to
-- REMOVE for each group.
SELECT
  lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) AS normalized_name,
  count(*)                                            AS copies,
  array_agg(id   ORDER BY name)                       AS school_ids,
  array_agg(name ORDER BY name)                       AS names,
  array_agg(is_active ORDER BY name)                  AS active_flags
FROM public.schools
GROUP BY 1
HAVING count(*) > 1
ORDER BY copies DESC;

-- ── STEP 2 — merge ONE duplicate into the keeper. Repeat per pair. ──
-- Replace <KEEPER_ID> with the row to keep and <DUPE_ID> with the row to remove.
-- Moves member links to the keeper (skipping members already linked to it),
-- drops the leftover dupe links, then deactivates the dupe so it disappears from
-- search. Swap the final UPDATE for a DELETE once you're confident.
BEGIN;

UPDATE public.member_schools ms
   SET school_id = '<KEEPER_ID>'::uuid
 WHERE ms.school_id = '<DUPE_ID>'::uuid
   AND NOT EXISTS (
     SELECT 1 FROM public.member_schools k
      WHERE k.member_id = ms.member_id
        AND k.school_id = '<KEEPER_ID>'::uuid
   );

DELETE FROM public.member_schools WHERE school_id = '<DUPE_ID>'::uuid;

UPDATE public.schools SET is_active = false WHERE id = '<DUPE_ID>'::uuid;
-- DELETE FROM public.schools WHERE id = '<DUPE_ID>'::uuid;  -- once verified

COMMIT;
