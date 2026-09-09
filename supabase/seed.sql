-- seed.sql — deterministic fixtures for a NON-PRODUCTION database.
--
-- Applied after supabase/baseline.sql by `npm run seed:dev`, which refuses to
-- run against the production project.
--
-- Two rules shape everything below.
--
-- 1. FIXED UUIDs. Every fixture has a hard-coded id in the 0000…-style ranges
--    below, so a Playwright spec can navigate straight to /admin/members/<id>
--    instead of creating a member through the UI first. That difference is most
--    of the runtime of an E2E suite.
--
-- 2. NO REAL PEOPLE. Every address is on `example.test`, a reserved TLD that
--    cannot receive mail (RFC 2606). The safelist in lib/email.ts is the real
--    guard; this is the belt to its braces, so that even a misconfigured
--    environment has nowhere to send.
--
-- Idempotent: re-running updates fixtures in place rather than duplicating, so
-- it is safe to run after every migration.

begin;

-- ── Reference data ───────────────────────────────────────────────────────────
--
-- Configuration rather than personal data, so these are copied verbatim from
-- production — INCLUDING the tier UUIDs. lib/entitlements and lib/access-gates
-- resolve tiers by id, so a dev database with different ids would exercise
-- different code paths than production and prove nothing.

insert into public.membership_tiers (id, name, age_bracket, is_free, sort_order, annual_cost_cents, default_grant_months) values
  ('14ab326d-55e8-4a1e-aac9-5240381ec115', 'Explorer',        'high_school', true,   1,     0, null),
  ('d7ce1bbe-acc1-4ce0-8975-a8f1873a3271', 'Pathfinder',      'high_school', false,  2,  5900,   12),
  ('0b110704-3661-48a6-8ca8-39d8014c816d', 'Scholar',         'high_school', false,  3, 11900,   12),
  ('da489c48-af72-464b-93b5-78d7659ea007', 'Alumni',          'college',     true,   4,     0, null),
  ('0e80f5f2-bab5-4858-b6b8-5b672ff3a7f2', 'Contributor',     'college',     false,  5, 24900,   12),
  ('c81616cc-60ef-479c-8517-7fe7a5237733', 'Counselor',       'college',     false,  6, 49900,   12),
  ('5556f8de-ef2c-4804-9aa9-448bef61fa0c', 'Educator',        'adult',       true,   7,     0, null),
  ('94cc5c95-1045-4ffb-ba7f-24ff43d17403', 'Catalyst',        'adult',       false,  8, 14900,   12),
  ('5b59f6a8-790e-4d18-8622-ed4e9daa03e2', 'Innovator',       'adult',       false,  9, 49900,   12),
  ('9ef60d99-c29f-4e54-8d54-406b555af0af', 'Trailblazer',     'adult',       false, 10, 99900,   12),
  ('6ee2314c-d24f-47dc-9599-2f9136b06884', 'Subscriber',      null,          true,  20,     0, null),
  ('1ec9eaef-8a8c-4ab5-95e5-2cab33ced9a1', 'Parent/Guardian', 'adult',       true,  21,     0, null)
on conflict (id) do update set
  name = excluded.name,
  age_bracket = excluded.age_bracket,
  is_free = excluded.is_free,
  sort_order = excluded.sort_order,
  annual_cost_cents = excluded.annual_cost_cents,
  default_grant_months = excluded.default_grant_months;

insert into public.ethnicity_options (name)
select v from (values ('Asian'), ('Black'), ('Hispanic'), ('Native American'),
                      ('Pacific Islander'), ('Prefer Not To Say'), ('White (Caucasian)')) t(v)
where not exists (select 1 from public.ethnicity_options e where e.name = t.v);

insert into public.allergy_options (name)
select v from (values ('Dairy / Lactose Free'), ('Gluten Free'), ('Halal'), ('Kosher'),
                      ('None'), ('Other'), ('Vegan'), ('Vegetarian')) t(v)
where not exists (select 1 from public.allergy_options a where a.name = t.v);

-- ── Members ──────────────────────────────────────────────────────────────────
--
-- One per role that gates a different part of the app. `clerk_user_id` is left
-- NULL deliberately: it must match a real user in YOUR Clerk development
-- instance, and a wrong value is worse than none (it silently attaches a real
-- session to the wrong member). See the note at the end of this file.
--
-- Ages are expressed as intervals rather than literal dates so the high-school
-- fixture does not quietly age into `adult` and start failing tier gates a year
-- from now.

insert into public.members (
  id, first_name, last_name, date_of_birth, gender, email,
  age_bracket, event_role, grade, tshirt_size, is_active, marketing_consent
) values
  ('00000000-0000-4000-a000-000000000001', 'Ada',  'Student',
   (current_date - interval '16 years')::date, 'female', 'ada.student@example.test',
   'high_school', 'participant', 'grade_11', 'M', true, true),

  ('00000000-0000-4000-a000-000000000002', 'Grace', 'Teacher',
   (current_date - interval '41 years')::date, 'female', 'grace.teacher@example.test',
   'adult', 'teacher', null, 'L', true, true),

  ('00000000-0000-4000-a000-000000000003', 'Alan', 'Admin',
   (current_date - interval '38 years')::date, 'male', 'alan.admin@example.test',
   'adult', 'adult', null, 'L', true, false),

  ('00000000-0000-4000-a000-000000000004', 'Mae',  'Mentor',
   (current_date - interval '29 years')::date, 'prefer_not_to_say', 'mae.mentor@example.test',
   'college', 'mentor', null, 'S', true, true),

  -- Inactive on purpose: access gates that only ever see active members are not
  -- actually being tested.
  ('00000000-0000-4000-a000-000000000005', 'Ida', 'Lapsed',
   (current_date - interval '17 years')::date, 'female', 'ida.lapsed@example.test',
   'high_school', 'participant', 'grade_12', 'M', false, false)
on conflict (id) do update set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email,
  age_bracket = excluded.age_bracket,
  event_role = excluded.event_role,
  is_active = excluded.is_active;

-- ── Memberships ──────────────────────────────────────────────────────────────
--
-- Deliberately spans the states the tier logic branches on: a free tier, a paid
-- tier, a complimentary grant, and one already expired.

insert into public.member_memberships (id, member_id, tier_id, started_at, expires_at, renewal_status, is_complimentary) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001',
   'd7ce1bbe-acc1-4ce0-8975-a8f1873a3271', current_date - 30, current_date + 335, 'active', false),

  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002',
   '5556f8de-ef2c-4804-9aa9-448bef61fa0c', current_date - 60, null, 'active', true),

  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000004',
   '0e80f5f2-bab5-4858-b6b8-5b672ff3a7f2', current_date - 200, current_date + 165, 'active', false),

  -- Expired yesterday: the boundary the membership-expiry cron acts on.
  ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000005',
   '14ab326d-55e8-4a1e-aac9-5240381ec115', current_date - 400, current_date - 1, 'expired', false)
on conflict (id) do update set
  tier_id = excluded.tier_id,
  started_at = excluded.started_at,
  expires_at = excluded.expires_at,
  renewal_status = excluded.renewal_status,
  is_complimentary = excluded.is_complimentary;

-- ── Roles ────────────────────────────────────────────────────────────────────
--
-- Admin access is enforced in server code rather than by RLS (GO-LIVE §2), so a
-- fixture with the staff role is the only way an E2E run can reach /admin.

insert into public.member_roles (id, member_id, role) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000003', 'staff'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000002', 'teacher'),
  ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-a000-000000000004', 'mentor'),
  ('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-a000-000000000001', 'member')
on conflict (id) do update set role = excluded.role;

-- ── An event registration ────────────────────────────────────────────────────
--
-- `event_slug` intentionally does NOT match a real Sanity document. A dev
-- database pointed at the production Sanity dataset would otherwise attach
-- fixture registrations to a real event in every admin view.

insert into public.registrations (
  id, event_slug, event_title, type, status,
  teacher_first_name, teacher_last_name, teacher_email, school_name,
  school_address_city, school_address_state
) values
  ('00000000-0000-4000-d000-000000000001', 'seed-regional-challenge',
   'Seed Regional Challenge (fixture)', 'group', 'confirmed',
   'Grace', 'Teacher', 'grace.teacher@example.test', 'Fixture High School',
   'Denver', 'CO'),

  ('00000000-0000-4000-d000-000000000002', 'seed-regional-challenge',
   'Seed Regional Challenge (fixture)', 'individual', 'pending',
   null, null, null, 'Fixture High School', 'Denver', 'CO')
on conflict (id) do update set
  status = excluded.status,
  event_title = excluded.event_title;

insert into public.participants (
  id, registration_id, first_name, last_name, email, phone, date_of_birth,
  gender, t_shirt_size, school_name, age_bracket, event_role, grade
) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-d000-000000000001',
   'Ada', 'Student', 'ada.student@example.test', '+15550100',
   (current_date - interval '16 years')::date, 'female', 'M',
   'Fixture High School', 'high_school', 'participant', 'grade_11'),

  ('00000000-0000-4000-e000-000000000002', '00000000-0000-4000-d000-000000000001',
   'Ravi', 'Teammate', 'ravi.teammate@example.test', '+15550101',
   (current_date - interval '17 years')::date, 'male', 'L',
   'Fixture High School', 'high_school', 'participant', 'grade_12')
on conflict (id) do update set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  email = excluded.email;

-- ── A community space ────────────────────────────────────────────────────────

insert into public.community_spaces (id, slug, name, description, display_order, is_archived) values
  ('00000000-0000-4000-f000-000000000001', 'seed-commons', 'Seed Commons (fixture)',
   'Fixture space for local and E2E testing.', 1, false)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  is_archived = excluded.is_archived;

commit;

-- ── After seeding: link Clerk users ──────────────────────────────────────────
--
-- `clerk_user_id` is NULL above because it has to match YOUR Clerk development
-- instance. Create three users there (member / teacher / admin), then:
--
--   update public.members set clerk_user_id = 'user_...'
--    where id = '00000000-0000-4000-a000-000000000001';  -- Ada, member
--   update public.members set clerk_user_id = 'user_...'
--    where id = '00000000-0000-4000-a000-000000000002';  -- Grace, teacher
--   update public.members set clerk_user_id = 'user_...'
--    where id = '00000000-0000-4000-a000-000000000003';  -- Alan, admin
--
-- Those three ids are what Playwright's storageState fixtures will authenticate
-- as in Phase 4. Keep the mapping in the dev Clerk instance, never in this file
-- — user ids are environment-specific and committing them would break the seed
-- for anyone with a different Clerk instance.
