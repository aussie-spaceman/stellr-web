-- Migration 064: coaching workshops as containers (convergence).
--
-- A coaching workshop = mentoring_cohorts(container_type='coaching',
-- mentor_member_id = the coach) with the coachee on the cohort_members roster
-- (relationship 'participant'). This brings coaching onto the same container +
-- roster model as competitions and mentoring, so it appears in the member access
-- panel and supports a direct admin grant.
--
-- This backfill creates a container per existing (coachee, coach) coaching
-- session pair. ADDITIVE — the live coaching access path (the 1:1 chat keyed on
-- coachee/coach, the session/booking flow) is unchanged. Idempotent.

DO $$
DECLARE
  r        RECORD;
  new_id   uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT s.member_id AS coachee, s.host_member_id AS coach
    FROM public.sessions s
    WHERE s.session_type = 'coaching'
      AND s.member_id IS NOT NULL
      AND s.host_member_id IS NOT NULL
  LOOP
    -- Skip if a coaching container already exists for this coach + coachee pair.
    IF EXISTS (
      SELECT 1
      FROM public.mentoring_cohorts c
      JOIN public.cohort_members cm ON cm.cohort_id = c.id
      WHERE c.container_type = 'coaching'
        AND c.mentor_member_id = r.coach
        AND cm.member_id = r.coachee
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.mentoring_cohorts (name, container_type, mentor_member_id, lifecycle)
    VALUES (
      'Coaching — ' || COALESCE(
        NULLIF(trim((SELECT first_name || ' ' || last_name FROM public.members WHERE id = r.coachee)), ''),
        'coachee'),
      'coaching', r.coach, 'active'
    )
    RETURNING id INTO new_id;

    INSERT INTO public.cohort_members (cohort_id, member_id, relationship, status)
    VALUES (new_id, r.coachee, 'participant', 'active')
    ON CONFLICT (cohort_id, member_id) DO NOTHING;
  END LOOP;
END $$;
