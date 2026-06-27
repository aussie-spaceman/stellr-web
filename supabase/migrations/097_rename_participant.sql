-- 097_rename_participant.sql
-- Standardization sweep · Stage 4 (Roles) — rename the canonical participant role.
--
-- The event_role_type enum value 'school_student' is renamed to the canonical
-- 'participant'. This is an in-place value rename: existing members.event_role and
-- participants.event_role rows automatically reflect the new label (same underlying
-- value). 'school_student_manager' is a DIFFERENT value and is left untouched.
--
-- Runs AFTER 096 (member_roles backfill reads the old 'school_student' value). The
-- app code literals were swept 'school_student' → 'participant' in the same change,
-- so this migration + the code must deploy together (old code querying 'school_student'
-- would hit an invalid-enum error once this is applied, and vice-versa).
--
-- tier_grant_rules.conditions is JSONB (not the enum), so the {"event_role":"school_student"}
-- conditions are updated explicitly to keep the grant-rules engine matching.
--
-- participants.event_role and training_assignments.event_role are TEXT columns (NOT the
-- enum), so the value rename does NOT touch their data — they still hold 'school_student'.
-- Readers match against the (now renamed) enum values, so these text rows must be migrated
-- too, or rosters / training assignments silently stop matching.

begin;

alter type event_role_type rename value 'school_student' to 'participant';

update tier_grant_rules
   set conditions = jsonb_set(conditions, '{event_role}', '"participant"')
 where conditions->>'event_role' = 'school_student';

-- TEXT columns that mirror event_role — migrate their data to the canonical value.
update participants          set event_role = 'participant' where event_role = 'school_student';
update training_assignments  set event_role = 'participant' where event_role = 'school_student';

commit;
