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
--      enter that candidate's SSN / DOB / city-state-zip EXACTLY as carried in
--      the nickname below. The SSN drives the mock result.
--   4. When certification is done, run the CLEANUP block at the bottom.
--
-- The nickname on each row carries the full mock PII + expected result and is
-- the cleanup marker ('CHECKR TEST ...').
--
-- ENTER THE PII EXACTLY (22 Sept 2026)
--   Checkr's docs: staging data that does not match the mocked-candidate sheet
--   leaves the report "in pending status indefinitely". It does not error, and
--   nothing on our side can tell that apart from a slow report — the row simply
--   sits at in_progress for ever.
--
--   This bit on 22 Sept: every candidate here was seeded with DOB 1983-02-10,
--   but **Vito Andolini's mock DOB is 1954-12-07** — he is the only exception in
--   the sheet. His report never resolved. The DOBs and addresses below are now
--   taken verbatim from `API_Mock_Candidates__1_.xlsx`:
--     Google Drive (david.shaw@stellreducation.org) -> Shared drives/InSimEd/
--     Stellr Web App - Resources/Teck Stack/Checkr/
--
--   Stellr never sends DOB or address to Checkr (the adapter posts only name,
--   email and work_locations) — the candidate types them on the hosted page. The
--   member DOB is set to the mock DOB anyway so the two never disagree.

with cfg as (
  select 'david.shaw@insimeducation.com'::text as inbox            -- <<< EDIT THIS LINE
),
-- first, last, ssn, dob, city/state/zip, dl#, expected result — verbatim from
-- API_Mock_Candidates__1_.xlsx (see header). Vito's DOB is NOT 1983-02-10.
roster(first_name, last_name, ssn, dob, address, dl, expect) as (values
  ('Bud',         'Richman',  '544-25-5544', date '1983-02-10', 'New York, NY 10080',                      'CA/A2355578',        'Clear'),
  ('Judge',       'Judy',     '667-68-6677', date '1983-02-10', 'Miami, FL 33145',                         'CA/R2233344',        'Consider'),
  ('Lady',        'GaGa',     '223-24-2233', date '1983-02-10', '11055 Delano, Detroit, MI 48242',         'CA/W2233344',        'Consider'),
  ('Samuel',      'Adams',    '556-58-5566', date '1983-02-10', '1280 25th St., Denver, CO 80205',         'CA/X2233344',        'Consider'),
  ('Little',      'John',     '011-02-0011', date '1983-02-10', '2634 Worldgateway Pl, Detroit, MI 48242', 'CA/Z2233344',        'Consider'),
  ('Roll',        'Tide',     '112-14-1122', date '1983-02-10', '195 S Murphy Ave, San Jose, CA 94088',    'CA/S2233344',        'Consider'),
  ('Vito',        'Andolini', '494-24-7562', date '1954-12-07', 'Newark, NJ 07103',                        'NJ/A98484372838901', 'Canceled'),
  ('Remy',        'Gonz',     'bad 223-23-2239 first, then 223-23-2230', date '1983-02-10', 'Romulus, MI 48242',  'MI/B434171800734', 'Pending -> Clear'),
  ('Jen',         'Kasp',     'bad 110-10-7777 first, then 110-10-1110', date '1983-02-10', 'San Jose, CA 94088', 'CA/M1223334',      'Pending -> Clear'),
  ('Alex',        'Taylor',   '544-21-5544', date '1983-02-10', 'New York, NY 10133',                      'CA/A2315179',        'Clear w/ Canceled (NEEDS crim+MVR package)'),
  ('Requisition', 'Tester',   '445-46-4455', date '1983-02-10', 'Honolulu, HI 96795',                      'CA/P2233344',        'Consider'),
  ('Tom',         'Brady',    '001-02-0011', date '1983-02-10', 'Omaha, NE 68101',                         'CA/V2233344',        'Consider'),
  ('Peter',       'Griffin',  '667-69-6677', date '1983-02-10', '3622 Coral Way Apt 0702, Miami, FL 33145','CA/Y2233344',        'Consider'),
  ('Camo',        'Time',     '011-02-0012', date '1983-02-10', '41-168 Poliala St, Honolulu, HI 96795',   'CA/T2233344',        'Consider')
)
insert into public.members
  (first_name, last_name, date_of_birth, gender, email, age_bracket, event_role, nickname)
select
  r.first_name,
  r.last_name,
  r.dob,
  'prefer_not_to_say'::gender_type,
  split_part(cfg.inbox, '@', 1) || '+checkr' || lower(r.first_name)
    || '@' || split_part(cfg.inbox, '@', 2),
  'adult'::age_bracket_type,
  'mentor'::event_role_type,
  'CHECKR TEST · SSN ' || r.ssn
    || ' · DOB ' || to_char(r.dob, 'YYYY-MM-DD')
    || ' · ' || r.address
    || ' · DL ' || r.dl
    || ' -> ' || r.expect
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
