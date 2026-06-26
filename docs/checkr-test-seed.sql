-- Checkr API-certification test members (PRD §13).
--
-- Seeds one Stellr member per Checkr mock candidate so you can order a background
-- check for each from the admin UI without hand-entering them. Run in the
-- Supabase SQL editor of the TEST database that the deployed (staging) app reads.
--
-- HOW TO USE
--   1. Edit the inbox on the marked line below to an address YOU control.
--      Gmail's +alias trick means every candidate's invite lands in one inbox:
--      you@gmail.com  ->  you+checkrbud@gmail.com, you+checkrjudge@gmail.com, ...
--   2. Run this whole script (safe to re-run — skips emails that already exist).
--   3. In Stellr admin, open each member -> Background Check panel -> Order.
--      Open the hosted apply page (invitation_url on the row, or the email) and
--      enter that candidate's SSN / DOB (1983-02-10) / address from the
--      spreadsheet. The SSN drives the mock result.
--   4. When certification is done, run the CLEANUP block at the bottom.
--
-- The nickname on each row carries the SSN + expected result as a reminder and
-- is the cleanup marker ('CHECKR TEST ...').

with cfg as (
  select 'david.shaw@insimeducation.com'::text as inbox            -- <<< EDIT THIS LINE
),
roster(first_name, last_name, ssn, expect) as (values
  ('Bud',         'Richman',  '544-25-5544',                              'Clear'),
  ('Judge',       'Judy',     '667-68-6677',                              'Consider'),
  ('Lady',        'GaGa',     '223-24-2233',                              'Consider'),
  ('Samuel',      'Adams',    '556-58-5566',                              'Consider'),
  ('Little',      'John',     '011-02-0011',                              'Consider'),
  ('Roll',        'Tide',     '112-14-1122',                              'Consider'),
  ('Vito',        'Andolini', '494-24-7562',                              'Canceled'),
  ('Remy',        'Gonz',     '223-23-2230 (enter bad 223-23-2239 first)','Pending -> Clear'),
  ('Jen',         'Kasp',     '110-10-1110 (enter bad 110-10-7777 first)','Pending -> Clear'),
  ('Alex',        'Taylor',   '544-21-5544 + DL CA/A2315179 (crim+MVR)',  'Clear w/ Canceled'),
  ('Requisition', 'Tester',   '445-46-4455',                              'Consider'),
  ('Tom',         'Brady',    '001-02-0011',                              'Consider'),
  ('Peter',       'Griffin',  '667-69-6677',                              'Consider'),
  ('Camo',        'Time',     '011-02-0012',                              'Consider')
)
insert into public.members
  (first_name, last_name, date_of_birth, gender, email, age_bracket, event_role, nickname)
select
  r.first_name,
  r.last_name,
  date '1983-02-10',
  'prefer_not_to_say'::gender_type,
  split_part(cfg.inbox, '@', 1) || '+checkr' || lower(r.first_name)
    || '@' || split_part(cfg.inbox, '@', 2),
  'adult'::age_bracket_type,
  'mentor'::event_role_type,
  'CHECKR TEST · SSN ' || r.ssn || ' -> ' || r.expect
from cfg, roster r
where not exists (
  select 1 from public.members m
  where m.email = split_part(cfg.inbox, '@', 1) || '+checkr' || lower(r.first_name)
    || '@' || split_part(cfg.inbox, '@', 2)
);

-- Verify the seed
select first_name, last_name, email, event_role, nickname
from public.members
where nickname like 'CHECKR TEST%'
order by first_name;


-- ─────────────────────────────────────────────────────────────────────────────
-- CLEANUP — run ONLY after certification testing is complete. Removes the test
-- members and everything that references them (FK order matters).
-- ─────────────────────────────────────────────────────────────────────────────
-- delete from public.member_activity_log
--  where member_id in (select id from public.members where nickname like 'CHECKR TEST%');
-- delete from public.member_background_checks
--  where member_id in (select id from public.members where nickname like 'CHECKR TEST%');
-- delete from public.member_teacher_licenses
--  where member_id in (select id from public.members where nickname like 'CHECKR TEST%');
-- delete from public.members where nickname like 'CHECKR TEST%';
