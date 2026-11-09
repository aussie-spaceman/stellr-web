-- Event Manager as an event-specific role granted from the member page, and
-- background checks a member already holds from another organisation.
--
-- 1. event_manager_assignments gains an expiry and a record of what cleared the
--    person. An Event Manager can read that event's roster: minors' details,
--    medical notes and background summaries. So the grant is time-boxed (event
--    end + 30 days by default, editable by an admin) and is only made to a
--    cleared adult. Readers ignore expired rows (lib/event-manager/active.ts);
--    the daily membership-expiry cron deletes them and clears the Clerk role.
--
--    expires_at stays nullable: rows written before this change have no expiry
--    and keep working. Rows whose event is in the mirror are backfilled to the
--    event's end + 30 days. The member page shows any remaining null as
--    "No expiry" so an admin can set one. Every new grant carries one.
--
-- 2. member_external_background_checks: one per member, like
--    member_teacher_licenses. The document is mandatory (document_path NOT
--    NULL). It clears nobody until an admin verifies it, and a verify is bound
--    to the version the admin reviewed (updated_at), as for licenses (BG-9).
--    Valid for 3 years from completed_on, or until document_expires_on if
--    that is earlier (lib/compliance.ts).

ALTER TABLE public.event_manager_assignments
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.members (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS clearance_basis text
    CHECK (clearance_basis IS NULL OR clearance_basis IN ('background_check', 'external_background_check', 'teacher_license')),
  ADD COLUMN IF NOT EXISTS granted_by_label text CHECK (granted_by_label IS NULL OR char_length(granted_by_label) <= 300),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS event_manager_assignments_expires_idx
  ON public.event_manager_assignments (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_manager_assignments_member_idx
  ON public.event_manager_assignments (member_id) WHERE member_id IS NOT NULL;

-- Backfill: link existing rows to their member, and expire them 30 days after
-- the event (ends_at is the exclusive end, local midnight after the last day).
UPDATE public.event_manager_assignments a
   SET member_id = m.id
  FROM public.members m
 WHERE a.member_id IS NULL
   AND m.clerk_user_id = a.clerk_user_id;

UPDATE public.event_manager_assignments a
   SET expires_at = e.ends_at + interval '30 days'
  FROM public.events e
 WHERE a.expires_at IS NULL
   AND e.slug = a.event_slug
   AND e.ends_at IS NOT NULL;

-- Only the service role touches this table (the app's server client). RLS has
-- no policy for anon/authenticated, so the old grants were inert; revoke them
-- so a future policy can't open them by accident.
REVOKE ALL ON public.event_manager_assignments FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.member_external_background_checks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id            uuid NOT NULL UNIQUE REFERENCES public.members (id) ON DELETE CASCADE,
  -- Who ran the check: a school district, a state agency, a screening vendor.
  issuer               text NOT NULL CHECK (char_length(btrim(issuer)) BETWEEN 1 AND 200),
  completed_on         date NOT NULL,
  -- An expiry printed on the document, when there is one. Validity ends at the
  -- earlier of this and completed_on + 3 years.
  document_expires_on  date,
  -- Private teacher-licenses bucket, under "<member_id>/bc/". Mandatory.
  document_path        text NOT NULL CHECK (char_length(document_path) BETWEEN 1 AND 500),
  verified_at          timestamptz,
  verified_by          uuid,
  verified_label       text,
  -- 'member' or 'admin': who submitted the current version.
  submitted_by         text NOT NULL DEFAULT 'member' CHECK (submitted_by IN ('member', 'admin')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_external_bc_dates_check
    CHECK (document_expires_on IS NULL OR document_expires_on >= completed_on)
);

ALTER TABLE public.member_external_background_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_external_background_checks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_external_background_checks TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access member_external_background_checks"
    ON public.member_external_background_checks FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE public.member_external_background_checks IS
  'A background check the member already holds from another organisation. Clears nobody until an admin verifies it (lib/compliance.ts).';
