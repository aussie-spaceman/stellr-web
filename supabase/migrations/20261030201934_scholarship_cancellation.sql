-- Cancelling a scholarship offer: by an admin at any time, and automatically
-- when the student's registration is withdrawn (lib/scholarship-cancel.ts).
--
-- Before this an offer, once made, stayed live: a student who withdrew from the
-- event kept a working offer link, and the review page read the withdrawn
-- registration as "awaiting details".
--
-- 'cancelled' is a decision like the others. Who cancelled it and why sit in
-- their own columns, so the reviewer who made the offer (reviewed_*) is kept.

ALTER TABLE public.scholarship_applications
  DROP CONSTRAINT IF EXISTS scholarship_applications_status_check;
ALTER TABLE public.scholarship_applications
  ADD CONSTRAINT scholarship_applications_status_check
  CHECK (status IN ('submitted', 'offered', 'not_offered', 'withdrawn', 'cancelled'));

ALTER TABLE public.scholarship_applications
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
  -- 'admin' from the review page; 'withdrawal' when the registration was withdrawn.
  ADD COLUMN IF NOT EXISTS cancellation_source text,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  -- The admin's Clerk user id and name; null for an automatic cancellation.
  ADD COLUMN IF NOT EXISTS cancelled_by        text,
  ADD COLUMN IF NOT EXISTS cancelled_by_name   text;

DO $$ BEGIN
  ALTER TABLE public.scholarship_applications
    ADD CONSTRAINT scholarship_cancellation_source_check
    CHECK (cancellation_source IS NULL OR cancellation_source IN ('admin', 'withdrawal'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.scholarship_applications
    ADD CONSTRAINT scholarship_cancellation_complete
    CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancellation_source IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Offers already left live on a withdrawn registration (one on prod, 30 Oct
-- 2026). Idempotent: a second run finds nothing still offered.
UPDATE public.scholarship_applications s
   SET status = 'cancelled',
       cancelled_at = COALESCE(r.withdrawn_at, now()),
       cancellation_source = 'withdrawal',
       cancellation_reason = 'Withdrew from the event'
  FROM public.registrations r
 WHERE r.id = s.registration_id
   AND s.status = 'offered'
   AND r.status = 'withdrawn';
