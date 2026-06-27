-- 096_member_roles_foundation.sql
-- Standardization sweep · Stage 4 (Roles) — FOUNDATION, parallel-run.
--
-- Introduces a single additive source of truth for the 11 canonical web-app roles,
-- replacing the scattered model (members.event_role enum, community_space_members.role,
-- cohort_members.relationship, object_roles, session_hosts capability flags, staff_roles).
--
-- This migration is ADDITIVE and NON-BREAKING: it creates member_roles and backfills it
-- from the existing sources, but does NOT modify or drop any existing table/column. The
-- app keeps reading the old sources until a later migration cuts the read paths over and
-- retires them. Backfill is idempotent (on conflict do nothing).
--
-- Canonical roles (additive on top of the base 'member'):
--   global classification : member, participant, student_manager, teacher, mentor,
--                           coach, parent, donor_sponsor, volunteer, staff
--   object-scoped manage  : moderator (spaces), plus mentor/coach/manager scoped to an object
-- (Guest/Subscriber stay membership *tiers*, not roles.)
--
-- Backfill mapping (sources → member_roles):
--   every member                          → member (global)
--   event_role 'teacher'                  → teacher
--   event_role 'school_student'           → participant            (the canonical name; enum
--                                                                    value rename happens in 097)
--   event_role 'school_student_manager'   → student_manager + participant (SM counts as student)
--   event_role 'mentor'                   → mentor
--   event_role 'parent'                   → parent
--   event_role 'donor'                    → donor_sponsor
--   event_role 'subscriber' / 'adult'     → (base member only)
--   community_space_members.role 'admin'  → moderator   (object: space)
--   community_space_members.role 'mentor' → mentor      (object: space)
--   session_hosts.can_mentor              → mentor (global)
--   session_hosts.can_coach               → coach  (global)
--   staff_roles                           → staff (global)
--   object_roles / Clerk admins / volunteer: no current rows to backfill (table supports them).

begin;

create type member_role_type as enum (
  'staff', 'coach', 'mentor', 'moderator', 'student_manager',
  'teacher', 'member', 'participant', 'volunteer', 'donor_sponsor', 'parent'
);

create table member_roles (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id) on delete cascade,
  role        member_role_type not null,
  scope       text not null default 'global' check (scope in ('global', 'object')),
  object_type text,   -- when scope='object': 'space'|'cohort'|'workshop'|'event'|'campaign'|'training'|'group'
  object_id   text,
  granted_by  uuid references members(id),
  source      text not null default 'backfill',  -- 'backfill'|'registration'|'admin'|'system'
  created_at  timestamptz not null default now(),
  constraint member_roles_uniq unique nulls not distinct (member_id, role, object_type, object_id)
);

create index member_roles_member_idx on member_roles (member_id);
create index member_roles_role_idx   on member_roles (role);
create index member_roles_object_idx on member_roles (object_type, object_id);

-- RLS: service role (server reads) full access; no anon/public access. Service key bypasses
-- RLS in any case, but the explicit policy is scoped TO service_role (not {public}) per the
-- systemic re-scope hygiene.
alter table member_roles enable row level security;
create policy member_roles_service_all on member_roles
  to service_role using (true) with check (true);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- base 'member' for everyone
insert into member_roles (member_id, role, scope, source)
select id, 'member', 'global', 'backfill' from members
on conflict do nothing;

-- event_role → canonical classification role
insert into member_roles (member_id, role, scope, source)
select id,
  (case event_role::text
    when 'teacher'                then 'teacher'
    when 'school_student'         then 'participant'
    when 'school_student_manager' then 'student_manager'
    when 'mentor'                 then 'mentor'
    when 'parent'                 then 'parent'
    when 'donor'                  then 'donor_sponsor'
  end)::member_role_type,
  'global', 'backfill'
from members
where event_role::text in ('teacher','school_student','school_student_manager','mentor','parent','donor')
on conflict do nothing;

-- Student Managers also count as participants
insert into member_roles (member_id, role, scope, source)
select id, 'participant', 'global', 'backfill' from members
where event_role::text = 'school_student_manager'
on conflict do nothing;

-- space admins → Moderator (object-scoped); space mentors → Mentor (object-scoped)
insert into member_roles (member_id, role, scope, object_type, object_id, source)
select member_id, 'moderator', 'object', 'space', space_id::text, 'backfill'
from community_space_members where role::text = 'admin'
on conflict do nothing;

insert into member_roles (member_id, role, scope, object_type, object_id, source)
select member_id, 'mentor', 'object', 'space', space_id::text, 'backfill'
from community_space_members where role::text = 'mentor'
on conflict do nothing;

-- session-host capability flags → global Coach / Mentor roles
insert into member_roles (member_id, role, scope, source)
select member_id, 'mentor', 'global', 'backfill' from session_hosts where can_mentor
on conflict do nothing;

insert into member_roles (member_id, role, scope, source)
select member_id, 'coach', 'global', 'backfill' from session_hosts where can_coach
on conflict do nothing;

-- existing DB platform staff → Staff
insert into member_roles (member_id, role, scope, source)
select member_id, 'staff', 'global', 'backfill' from staff_roles
on conflict do nothing;

commit;
