-- 032: Normalise participants.event_role to the members enum values.
--
-- participants.event_role is plain text and historically stored the form's
-- display strings ("School Student", "Teacher", "Adult") plus the teams
-- portal's 'student'. Readers match the enum values — the admin event page's
-- studentCount, the Companies auto-assign API, and the roster's company
-- dropdown all filter on event_role = 'school_student' — so display-string
-- rows were invisible to them (Auto-Assign Students stayed disabled with
-- "0 students to assign").
--
-- Write paths now normalise via lib/member-enums.ts normalizeEventRole();
-- this backfills the existing rows. Idempotent.

update public.participants set event_role = 'school_student'
  where event_role in ('School Student', 'Student', 'student');

update public.participants set event_role = 'school_student_manager'
  where event_role = 'School Student Manager';

update public.participants set event_role = 'teacher'    where event_role = 'Teacher';
update public.participants set event_role = 'adult'      where event_role = 'Adult';
update public.participants set event_role = 'mentor'     where event_role = 'Mentor';
update public.participants set event_role = 'parent'     where event_role = 'Parent';
update public.participants set event_role = 'subscriber' where event_role = 'Subscriber';
