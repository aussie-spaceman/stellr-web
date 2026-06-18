-- ============================================================================
-- Stellr — local/staging SEED matching the redesign mockups
-- (Avanee K., "Lunar Settlement Challenge", Team Aurora, Aerospace Design, etc.)
--
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING. Safe to re-run.
-- Run AFTER all migrations, against a NON-production DB:
--   psql "$SUPABASE_DB_URL" -f seed.sql
-- (or paste into the Supabase SQL editor on a dev project).
--
-- ⚠ Two things to do after running — see seed/README.md:
--   1. Set the Avanee row's clerk_user_id to YOUR Clerk dev user id so the
--      personalized Home renders when you sign in.
--   2. Create the matching Sanity event from seed/sanity-event.ndjson.
--
-- Column lists below reflect migrations 012/017/018/019/020 + database.types.ts.
-- If your live `members`/`participants` tables have extra NOT-NULL columns
-- without defaults, add values for them (introspect with \d public.members).
-- ============================================================================

BEGIN;

-- ── Schools ─────────────────────────────────────────────────────────────────
INSERT INTO public.schools (id, name)
VALUES ('22222222-0000-0000-0000-000000000001', 'Lincoln High School')
ON CONFLICT (id) DO NOTHING;

-- ── Members ───────────────────────────────────────────────────────────────
-- clerk_user_id values are placeholders; replace Avanee's with your own (see README).
INSERT INTO public.members (id, clerk_user_id, first_name, last_name, email, event_role, school_address_state, date_of_birth)
VALUES
  ('11111111-1111-1111-1111-111111111101', 'seed_clerk_avanee',  'Avanee',  'Kapoor',  'avanee.seed@example.com',  'school_student',          'AZ', '2009-04-12'),
  ('11111111-1111-1111-1111-111111111102', 'seed_clerk_jordan',  'Jordan',  'Mensah',  'jordan.seed@example.com',  'school_student',          'AZ', '2008-09-03'),
  ('11111111-1111-1111-1111-111111111103', 'seed_clerk_sara',    'Sara',    'Reyes',   'sara.seed@example.com',    'mentor',                  'CA', '1991-02-20'),
  ('11111111-1111-1111-1111-111111111104', 'seed_clerk_okafor',  'Dr. Amara','Okafor', 'okafor.seed@example.com',  'mentor',                  'TX', '1985-11-30'),
  ('11111111-1111-1111-1111-111111111105', 'seed_clerk_beatrice','Beatrice','Nguyen',  'beatrice.seed@example.com','school_student',          'AZ', '2009-07-19'),
  ('11111111-1111-1111-1111-111111111106', 'seed_clerk_caitlin', 'Caitlin', 'Shaw',    'caitlin.seed@example.com', 'school_student',          'AZ', '2008-12-01'),
  ('11111111-1111-1111-1111-111111111107', 'seed_clerk_tomas',   'Tomas',   'Lindqvist','tomas.seed@example.com',  'school_student_manager',  'AZ', '2007-05-25')
ON CONFLICT (id) DO NOTHING;

-- Current school for each student member
INSERT INTO public.member_schools (member_id, school_id, is_current)
SELECT m.id, '22222222-0000-0000-0000-000000000001', true
FROM (VALUES
  ('11111111-1111-1111-1111-111111111101'::uuid),
  ('11111111-1111-1111-1111-111111111102'::uuid),
  ('11111111-1111-1111-1111-111111111105'::uuid),
  ('11111111-1111-1111-1111-111111111106'::uuid),
  ('11111111-1111-1111-1111-111111111107'::uuid)
) AS m(id)
ON CONFLICT DO NOTHING;

-- Directory opt-in (FR-COM-04) so the Member Directory is populated
INSERT INTO public.member_directory_prefs (member_id, is_visible, show_school, show_region)
VALUES
  ('11111111-1111-1111-1111-111111111101', true, true, true),
  ('11111111-1111-1111-1111-111111111102', true, true, true),
  ('11111111-1111-1111-1111-111111111103', true, false, true),
  ('11111111-1111-1111-1111-111111111105', true, true, true),
  ('11111111-1111-1111-1111-111111111106', true, true, false),
  ('11111111-1111-1111-1111-111111111107', true, true, true)
ON CONFLICT (member_id) DO NOTHING;

-- ── Community spaces ────────────────────────────────────────────────────────
-- (migration 012 already seeds general/competitions/study-hall; these add the
--  spaces shown in the mock. 'showcase' is paid-only to demo the locked state.)
INSERT INTO public.community_spaces (id, slug, name, description, min_tier_rank, display_order)
VALUES
  ('33333333-0000-0000-0000-000000000001', 'aerospace-design', 'Aerospace Design', 'Discuss structures & systems.', 0, 10),
  ('33333333-0000-0000-0000-000000000002', 'ask-an-engineer',  'Ask an Engineer',  'Mentor Q&A — pros on call.',    0, 11),
  ('33333333-0000-0000-0000-000000000003', 'showcase',         'Showcase',         'Share final projects.',          1, 12),
  ('33333333-0000-0000-0000-000000000004', 'off-topic',        'Off Topic',        'Anything goes.',                 0, 13)
ON CONFLICT (slug) DO NOTHING;

-- ── Posts + comments ────────────────────────────────────────────────────────
INSERT INTO public.community_posts (id, space_id, author_member_id, title, body_text, is_announcement, is_pinned, status, comment_count, created_at)
VALUES
  ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111102',
     'Radiator placement question', 'Has anyone modeled the radiator placement for the residential dome? Trying to balance thermal load.', false, false, 'published', 4, now() - interval '2 hours'),
  ('44444444-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111105',
     'Monorail vs tram for intra-base transit', 'We compared both — tram won on cost, monorail on throughput.', false, false, 'published', 2, now() - interval '1 day'),
  ('44444444-0000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111106',
     'Site selection: Whipple vs Hinshelwood', 'Sharing our illumination analysis for the two candidate craters.', false, false, 'published', 1, now() - interval '3 days'),
  ('44444444-0000-0000-0000-000000000004', '33333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111103',
     'Office hours this Thursday — drop your questions', 'I''ll be online 4–6pm ET. Post questions here ahead of time.', true, true, 'published', 3, now() - interval '5 hours'),
  ('44444444-0000-0000-0000-000000000005', '33333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111101',
     'How detailed should the life-support diagram be?', 'For judging, is a block diagram enough or do they want flow rates?', false, false, 'published', 0, now() - interval '8 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.community_comments (post_id, author_member_id, body_text, status, created_at)
VALUES
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111105', 'We put ours on the shaded slope — dropped peak temp a lot.', 'published', now() - interval '90 minutes'),
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111106', 'Same. Watch the view factor to the regolith though.',       'published', now() - interval '70 minutes'),
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111103', 'Good instinct — model the radiator as a two-sided surface.','published', now() - interval '40 minutes'),
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111101', 'This is super helpful, thank you!',                         'published', now() - interval '20 minutes'),
  ('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111101', 'How do you size a regenerative life-support loop?',         'published', now() - interval '3 hours'),
  ('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111102', 'Will you cover thermal budgeting?',                          'published', now() - interval '2 hours'),
  ('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111105', 'Can we get a recording if we miss it?',                      'published', now() - interval '1 hour')
ON CONFLICT DO NOTHING;

-- ── Training: modules → sections → items → progress → enrollment → assignment ─
INSERT INTO public.training_modules (id, title, description, material_kind, event_ref, min_tier_rank, is_published, display_order)
VALUES
  ('55555555-0000-0000-0000-000000000001', 'Engineering Design Process', 'The core method judges look for — define, ideate, prototype, test, iterate.', 'curriculum', 'event-lunar-settlement', 0, true, 0),
  ('55555555-0000-0000-0000-000000000002', 'Presenting to Judges',       'Structure a confident 8-minute design pitch.',                                'cte',        NULL,                    0, true, 1),
  ('55555555-0000-0000-0000-000000000003', 'Intro to CAD Modeling',      'Get productive in CAD for competition deliverables.',                         'general',    NULL,                    0, true, 2)
ON CONFLICT (id) DO NOTHING;

-- NOTE: migration 017 constrained training_modules.material_kind to
-- (general,event,campaign,cte); lib/training.ts also surfaces 'curriculum'.
-- If your CHECK doesn't yet allow 'curriculum', run:
--   ALTER TABLE public.training_modules DROP CONSTRAINT IF EXISTS training_modules_material_kind_check;
--   ALTER TABLE public.training_modules ADD CONSTRAINT training_modules_material_kind_check
--     CHECK (material_kind IN ('general','event','campaign','cte','curriculum'));

INSERT INTO public.training_sections (id, module_id, title, display_order, drip_days)
VALUES
  ('56000000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'Define & Research', 0, 0),
  ('56000000-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', 'Design & Build',    1, 0),
  ('56000000-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000001', 'Test & Iterate',    2, 0)
ON CONFLICT (id) DO NOTHING;

-- Items: EDP has 5 lessons (3 completed → 60%); Presenting has 5 (1 → 20%); CAD has 6 (0%).
INSERT INTO public.training_items (id, module_id, section_id, title, content_kind, external_url, estimated_minutes, display_order, status)
VALUES
  -- Engineering Design Process
  ('57000000-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000001', 'What judges reward',           'video', 'https://youtu.be/dQw4w9WgXcQ', 8,  0, 'published'),
  ('57000000-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000001', 'Framing the design problem',   'document', NULL, 12, 1, 'published'),
  ('57000000-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000002', 'Rapid prototyping basics',     'video', 'https://youtu.be/dQw4w9WgXcQ', 10, 2, 'published'),
  ('57000000-0000-0000-0000-000000000004', '55555555-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000003', 'Designing a test plan',        'document', NULL, 9,  3, 'published'),
  ('57000000-0000-0000-0000-000000000005', '55555555-0000-0000-0000-000000000001', '56000000-0000-0000-0000-000000000003', 'Iterating from results',       'link', 'https://example.com/iterate', 7, 4, 'published'),
  -- Presenting to Judges
  ('57000000-0000-0000-0000-000000000011', '55555555-0000-0000-0000-000000000002', NULL, 'Anatomy of a winning pitch', 'video', 'https://youtu.be/dQw4w9WgXcQ', 9,  0, 'published'),
  ('57000000-0000-0000-0000-000000000012', '55555555-0000-0000-0000-000000000002', NULL, 'Slide design for clarity',   'document', NULL, 11, 1, 'published'),
  ('57000000-0000-0000-0000-000000000013', '55555555-0000-0000-0000-000000000002', NULL, 'Handling Q&A',               'video', 'https://youtu.be/dQw4w9WgXcQ', 8,  2, 'published'),
  ('57000000-0000-0000-0000-000000000014', '55555555-0000-0000-0000-000000000002', NULL, 'Managing nerves',            'link', 'https://example.com/nerves', 6,  3, 'published'),
  ('57000000-0000-0000-0000-000000000015', '55555555-0000-0000-0000-000000000002', NULL, 'Dry-run checklist',          'document', NULL, 5,  4, 'published'),
  -- Intro to CAD Modeling
  ('57000000-0000-0000-0000-000000000021', '55555555-0000-0000-0000-000000000003', NULL, 'CAD interface tour',         'video', 'https://youtu.be/dQw4w9WgXcQ', 10, 0, 'published'),
  ('57000000-0000-0000-0000-000000000022', '55555555-0000-0000-0000-000000000003', NULL, 'Sketches & constraints',     'video', 'https://youtu.be/dQw4w9WgXcQ', 12, 1, 'published'),
  ('57000000-0000-0000-0000-000000000023', '55555555-0000-0000-0000-000000000003', NULL, 'Extrudes & revolves',        'document', NULL, 9,  2, 'published'),
  ('57000000-0000-0000-0000-000000000024', '55555555-0000-0000-0000-000000000003', NULL, 'Assemblies',                 'video', 'https://youtu.be/dQw4w9WgXcQ', 11, 3, 'published'),
  ('57000000-0000-0000-0000-000000000025', '55555555-0000-0000-0000-000000000003', NULL, 'Exporting for judging',      'document', NULL, 7,  4, 'published'),
  ('57000000-0000-0000-0000-000000000026', '55555555-0000-0000-0000-000000000003', NULL, 'Practice model',             'link', 'https://example.com/practice', 20, 5, 'published')
ON CONFLICT (id) DO NOTHING;

-- Avanee's progress: EDP 3/5 done, Presenting 1/5 done, CAD 0/6
INSERT INTO public.training_progress (member_id, item_id, status, completed_at)
VALUES
  ('11111111-1111-1111-1111-111111111101', '57000000-0000-0000-0000-000000000001', 'completed', now() - interval '6 days'),
  ('11111111-1111-1111-1111-111111111101', '57000000-0000-0000-0000-000000000002', 'completed', now() - interval '5 days'),
  ('11111111-1111-1111-1111-111111111101', '57000000-0000-0000-0000-000000000003', 'completed', now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111101', '57000000-0000-0000-0000-000000000011', 'completed', now() - interval '1 day')
ON CONFLICT (member_id, item_id) DO NOTHING;

INSERT INTO public.training_enrollments (member_id, module_id, enrolled_at)
VALUES
  ('11111111-1111-1111-1111-111111111101', '55555555-0000-0000-0000-000000000001', now() - interval '7 days'),
  ('11111111-1111-1111-1111-111111111101', '55555555-0000-0000-0000-000000000002', now() - interval '2 days')
ON CONFLICT (member_id, module_id) DO NOTHING;

-- Mandatory assignment tying EDP to the upcoming event (drives "due before your event")
INSERT INTO public.training_assignments (module_id, event_ref, event_role, is_mandatory, due_at)
VALUES
  ('55555555-0000-0000-0000-000000000001', 'event-lunar-settlement', 'all', true, now() + interval '10 days')
ON CONFLICT (module_id, event_ref, event_role) DO NOTHING;

-- ── Mentoring cohort + sessions + cohort chat ───────────────────────────────
INSERT INTO public.session_hosts (member_id, can_coach, can_mentor, bio)
VALUES ('11111111-1111-1111-1111-111111111104', false, true, 'Aerospace systems engineer; mentors design teams.')
ON CONFLICT (member_id) DO NOTHING;

INSERT INTO public.mentoring_cohorts (id, name, mentor_member_id, is_active)
VALUES ('66666666-0000-0000-0000-000000000001', 'Team Aurora Mentoring', '11111111-1111-1111-1111-111111111104', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cohort_members (cohort_id, member_id)
VALUES
  ('66666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111101'),
  ('66666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111102'),
  ('66666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111105')
ON CONFLICT (cohort_id, member_id) DO NOTHING;

INSERT INTO public.sessions (id, session_type, host_member_id, cohort_id, title, scheduled_start, scheduled_end, status)
VALUES
  ('77777777-0000-0000-0000-000000000001', 'mentoring', '11111111-1111-1111-1111-111111111104', '66666666-0000-0000-0000-000000000001', 'Mentor check-in · Dr. Okafor', now() + interval '3 days' + interval '16 hours', now() + interval '3 days' + interval '17 hours', 'scheduled'),
  ('77777777-0000-0000-0000-000000000002', 'mentoring', '11111111-1111-1111-1111-111111111104', '66666666-0000-0000-0000-000000000001', 'Team Aurora work session',     now() + interval '6 days' + interval '18 hours 30 minutes', now() + interval '6 days' + interval '20 hours', 'scheduled')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.session_participants (session_id, member_id)
VALUES
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111101'),
  ('77777777-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111102'),
  ('77777777-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111101')
ON CONFLICT (session_id, member_id) DO NOTHING;

INSERT INTO public.chat_channels (id, kind, cohort_id)
VALUES ('88888888-0000-0000-0000-000000000001', 'cohort', '66666666-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chat_messages (channel_id, author_member_id, body, created_at)
VALUES
  ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111104', 'Welcome Team Aurora! Drop your draft site-selection slide before Thursday.', now() - interval '2 days'),
  ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111101', 'On it — uploading tonight.', now() - interval '1 day 20 hours'),
  ('88888888-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111102', 'I''ll bring the thermal numbers.', now() - interval '1 day 4 hours')
ON CONFLICT DO NOTHING;

-- ── Event registration (so Home's "next event" + Academy assignment resolve) ──
-- The event itself is a Sanity doc (seed/sanity-event.ndjson, slug below).
INSERT INTO public.registrations (id, event_slug, event_title, type, status, registrant_role, details_method, invoice_requested, member_pays_individually, school_name, school_address_state)
VALUES
  ('99999999-0000-0000-0000-000000000001', 'lunar-settlement-challenge', 'Lunar Settlement Challenge', 'group', 'confirmed', 'student_manager', 'add_now', false, false, 'Lincoln High School', 'AZ')
ON CONFLICT (id) DO NOTHING;

-- Avanee as a confirmed participant of that event (member_id links to her member row).
-- membership_id is system-generated (omitted, per ParticipantInsert). ethnicity/
-- dietary are arrays. Adjust columns if your participants table differs.
INSERT INTO public.participants (id, registration_id, member_id, first_name, last_name, email, phone, date_of_birth, gender, ethnicity, t_shirt_size, school_name, age_bracket, event_role, dietary_requirements)
VALUES
  ('9a999999-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111101', 'Avanee', 'Kapoor', 'avanee.seed@example.com', '+1-555-0100', '2009-04-12', 'female', '{}', 'M', 'Lincoln High School', 'high_school', 'school_student', '{}')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ============================================================================
-- After running: see seed/README.md to (1) point Avanee at your Clerk user and
-- (2) create the Sanity event so the catalog + event hub resolve.
-- ============================================================================
