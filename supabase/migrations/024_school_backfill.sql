-- Migration 024: Backfill schools + member_schools from registration data
--
-- Registration routes historically stored the school only as free text on
-- registrations.school_name / participants.school_name without creating a
-- schools row or a member_schools link. Result: schools entered at event
-- registration (e.g. "Brighton High School") showed on the event roster but
-- were missing from /admin/schools and from each member's School section.
-- The routes now link schools at registration time; this migration repairs
-- the historical data.

-- 1) Create schools that exist only as free text on group registrations
--    (these carry address details). Case-insensitive match on trimmed name.
INSERT INTO public.schools (name, address_line1, city, state, postcode)
SELECT DISTINCT ON (lower(trim(r.school_name)))
       trim(r.school_name),
       nullif(trim(r.school_address_street), ''),
       nullif(trim(r.school_address_city), ''),
       nullif(trim(r.school_address_state), ''),
       nullif(trim(r.school_address_zip), '')
FROM public.registrations r
WHERE nullif(trim(r.school_name), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.schools s
    WHERE lower(trim(s.name)) = lower(trim(r.school_name))
  )
ORDER BY lower(trim(r.school_name)), r.created_at DESC;

-- 2) Create schools that exist only as free text on participant rows
--    (individual registrations — name only, no address captured).
INSERT INTO public.schools (name)
SELECT DISTINCT ON (lower(trim(p.school_name)))
       trim(p.school_name)
FROM public.participants p
WHERE nullif(trim(p.school_name), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.schools s
    WHERE lower(trim(s.name)) = lower(trim(p.school_name))
  )
ORDER BY lower(trim(p.school_name));

-- 3) Link members to their school via member_schools, derived from their most
--    recent participant row carrying a school name. Members that already have
--    a current school link are left untouched.
INSERT INTO public.member_schools (member_id, school_id, is_current, started_at)
SELECT DISTINCT ON (p.member_id)
       p.member_id,
       s.id,
       true,
       current_date
FROM public.participants p
JOIN public.schools s
  ON lower(trim(s.name)) = lower(trim(p.school_name))
WHERE p.member_id IS NOT NULL
  AND nullif(trim(p.school_name), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.member_schools ms
    WHERE ms.member_id = p.member_id AND ms.is_current = true
  )
ORDER BY p.member_id, p.created_at DESC
ON CONFLICT (member_id, school_id) DO NOTHING;
