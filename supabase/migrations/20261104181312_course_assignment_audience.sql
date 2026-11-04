-- Course assignment audience (4 Nov 2026).
--
-- A course assigned to an event or campaign reached everyone on its roster, and
-- the only way to narrow it was the per-tier grid. Membership tier stands in
-- poorly for "what does this person do at the event": a volunteer mentor and a
-- student can share a tier, and a student with no active tier falls through to
-- the default. Mentors could not be targeted at all.
--
-- audience narrows an assignment by the person's relationship to the event,
-- read from the roster an admin controls (cohort_members.relationship on the
-- event's event_participation containers), never from the self-chosen
-- members.event_role:
--   all           everyone on the roster (the behaviour before this column)
--   participants  relationship 'participant' (registered students)
--   volunteers    relationship 'volunteer' (the event's Volunteers panel)
-- The tier grid still applies on top. Only event and campaign Objects use it;
-- cohort/workshop/space assignments keep 'all'.
--
-- Idempotent: safe to re-run under the CLI or the Supabase MCP.

ALTER TABLE public.course_object_assignments
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all';

ALTER TABLE public.course_object_assignments
  DROP CONSTRAINT IF EXISTS course_object_assignments_audience_check;
ALTER TABLE public.course_object_assignments
  ADD CONSTRAINT course_object_assignments_audience_check
  CHECK (audience IN ('all', 'participants', 'volunteers'));

-- No new table; grant restated so an MCP apply cannot leave it unreadable.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_object_assignments TO service_role;
