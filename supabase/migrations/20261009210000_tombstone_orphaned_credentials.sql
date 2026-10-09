-- One-off backfill for deep review MP-2.
--
-- Before this release two erasure paths could leave a student's event
-- credential behind with their full name intact (and a public share page, if it
-- had been made public): a group-registration ("delete a group") hard delete
-- never tombstoned the students' credentials, and a member hard delete missed
-- event credentials issued before the student's account was linked (member_id
-- null at issue, participant_id set). Because credentials.member_id and
-- credentials.participant_id are both ON DELETE SET NULL, the delete nulled the
-- link and the row became ORPHANED — both FKs null — so no later
-- tombstoneCredentialsFor run (which matches on one of those FKs) could ever
-- find it again.
--
-- lib/deletion/execute.ts now tombstones on every hard-delete path before the
-- rows go, so no NEW orphans are created. This cleans up any that already
-- exist. An orphaned credential (both member_id and participant_id null) has no
-- living owner link by construction — the only way a credential reaches that
-- state is the FK nulling above — so blanking the name is always correct. The
-- number is deliberately kept so a verifier holding a CV still gets "withdrawn"
-- rather than a 404 that looks like a forgery (same contract as the runtime
-- tombstone).
--
-- Idempotent: the WHERE clause skips rows already tombstoned, so a re-run is a
-- no-op. NOT YET APPLIED — apply to dev, verify, then prod (see PR notes).

UPDATE public.credentials
   SET tombstoned_at = now(),
       recipient_name = '',
       visibility = 'private',
       updated_at = now()
 WHERE member_id IS NULL
   AND participant_id IS NULL
   AND tombstoned_at IS NULL;
