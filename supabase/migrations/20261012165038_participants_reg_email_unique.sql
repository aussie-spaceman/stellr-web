-- deep review REG-7 (= DB-3): close the group-join dedupe + seat-capacity race.
--
-- app/api/register/group-join/route.ts checks "already in this group?" with a
-- SELECT … maybeSingle() and then INSERTs. Two concurrent submissions of the
-- same join link both read "not present" and both insert, producing a duplicate
-- participant row for one person in one registration — two consent envelopes,
-- two Space grants, double individual-payment rows. There is no DB constraint to
-- catch it, so the read-then-insert is a true race.
--
-- A UNIQUE index on (registration_id, lower(email)) makes the second insert fail
-- with 23505; the route now treats that as the "already registered" 409. Keyed on
-- lower(email) so case variants of the same address collapse, matching the
-- case-insensitive matching the app already does.
--
-- No SECURITY DEFINER function and no new table, so no GRANT/RLS/REVOKE changes
-- are needed (lint:migrations security check does not apply here).
--
-- NOT YET APPLIED. Apply to dev then prod via the normal migration flow.
-- PRE-APPLY CHECK: any existing duplicate (registration_id, lower(email)) rows
-- must be de-duplicated first, or the index build fails. Find them with:
--   SELECT registration_id, lower(email) AS email, count(*)
--   FROM participants
--   WHERE email IS NOT NULL AND btrim(email) <> ''
--   GROUP BY registration_id, lower(email)
--   HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS participants_reg_email_uniq
  ON participants (registration_id, lower(email))
  WHERE email IS NOT NULL AND btrim(email) <> '';
