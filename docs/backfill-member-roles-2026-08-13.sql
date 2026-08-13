-- One-off backfill: seed member_roles for members who have no role rows at all.
--
-- Why they're missing: syncMemberClassificationRole was only called on the Clerk
-- webhook's CREATE branch, but the onboarding POST usually creates the member row
-- first — so the webhook took its LINK branch and never seeded roles, and the
-- onboarding route (the only place that knows the declared event_role) never
-- called the sync either. Both are fixed in commit aefee2a; this repairs the
-- members who registered before that.
--
-- Scope, verified by dry-run on 13 Aug 2026: 13 rows across 7 members —
--   janetsplanetofficial@gmail.com   teacher / adult       -> member, teacher
--   mmmatlock@wcpss.net              teacher / adult       -> member, teacher
--   mark.shaw@neoshr.com.au          mentor  / college     -> member, mentor
--   bill.allen@stellreducation.org   teacher / adult       -> member, teacher
--   david.michael.shaw+em@gmail.com  teacher / adult       -> member, teacher
--   david.michael.shaw+rudi@...      adult   / adult       -> member
--   david.michael.shaw+william@...   participant / high_school -> member, participant
--
-- The role mapping and the bracket filter mirror lib/member-roles.ts exactly
-- (classificationRolesFor + ROLES_BY_BRACKET), so this produces the same rows the
-- application would have written at signup.
--
-- Safe to re-run: the NOT EXISTS guard skips any member who already has roles.
-- Reversible: DELETE FROM member_roles WHERE source = 'backfill-2026-08-13';
--
-- Run inside a transaction and check the count before committing:
--
--   BEGIN;
--   <paste the statement below>
--   SELECT count(*) FROM member_roles WHERE source = 'backfill-2026-08-13';  -- expect 13
--   COMMIT;   -- or ROLLBACK if the count looks wrong

WITH implied AS (
  SELECT m.id AS member_id, m.age_bracket, r.role
  FROM members m
  CROSS JOIN LATERAL (
    SELECT unnest(
      ARRAY['member']::text[] || CASE m.event_role::text
        WHEN 'teacher'                THEN ARRAY['teacher']
        WHEN 'participant'            THEN ARRAY['participant']
        WHEN 'school_student_manager' THEN ARRAY['student_manager','participant']
        WHEN 'mentor'                 THEN ARRAY['mentor']
        WHEN 'parent'                 THEN ARRAY['parent']
        WHEN 'volunteer'              THEN ARRAY['volunteer']
        WHEN 'donor'                  THEN ARRAY['donor_sponsor']
        ELSE ARRAY[]::text[]  -- subscriber / adult -> base 'member' only
      END
    ) AS role
  ) r
  WHERE m.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM member_roles mr WHERE mr.member_id = m.id)
),
allowed AS (
  -- Drop roles the member's age bracket can't hold (ROLES_BY_BRACKET).
  SELECT DISTINCT member_id, role FROM implied
  WHERE role = ANY(CASE age_bracket::text
    WHEN 'high_school' THEN ARRAY['member','participant','student_manager']
    WHEN 'college'     THEN ARRAY['member','participant','volunteer','student_manager','mentor']
    WHEN 'adult'       THEN ARRAY['staff','coach','mentor','moderator','teacher','volunteer','donor_sponsor','parent','member']
    ELSE ARRAY['member']  -- unknown bracket: base role only, never a manage role
  END)
)
INSERT INTO member_roles (member_id, role, scope, source)
SELECT member_id, role::member_role_type, 'global', 'backfill-2026-08-13'
FROM allowed;
