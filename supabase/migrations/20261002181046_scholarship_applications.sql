-- Scholarship applications: the record behind /scholarship, the admin review
-- queue (/admin/scholarships) and the offer → register → pay flow.
-- Plan: docs/PLAN-scholarship-offers-2026-10-02.md.
--
-- Before this, an application was an email to hello@ and a HubSpot lead — no
-- row, so there was nothing to review in the app, nothing for the roster to
-- badge, and nothing for the member's history to show.
--
-- `status` stores only the reviewer's decision. How far the student has got
-- since the offer (details in, paid, attended) is read from the linked
-- registration and participant, never copied here, so the two cannot drift.

CREATE TABLE IF NOT EXISTS public.scholarship_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What the applicant submitted. `email` is treated as the student's own
  -- address (owner decision, 2 Oct 2026).
  first_name            text NOT NULL,
  last_name             text NOT NULL,
  email                 text NOT NULL,
  phone                 text,
  school                text,
  brief                 text NOT NULL,
  -- The activity label as the applicant saw it, plus the event it resolves to.
  -- event_slug is null for "Not sure yet" until the reviewer picks one.
  activity              text,
  event_slug            text,
  event_title           text,

  member_id             uuid REFERENCES public.members(id) ON DELETE SET NULL,

  status                text NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted', 'offered', 'not_offered', 'withdrawn')),
  -- Each level maps to one Stripe coupon (lib/scholarships.ts SCHOLARSHIP_LEVELS).
  percent_off           integer CHECK (percent_off IS NULL OR percent_off IN (33, 50, 67, 100)),
  -- Set once the student's registration exists — at offer time when they had
  -- already registered, otherwise when they complete their details.
  registration_id       uuid REFERENCES public.registrations(id) ON DELETE SET NULL,
  -- Capability token for the "complete your registration" and offer links,
  -- the same shape as registrations.pay_token (64 hex).
  offer_token           text UNIQUE,

  reviewed_by           text,
  reviewed_by_name      text,
  reviewed_at           timestamptz,
  offered_at            timestamptz,
  offer_emails_sent_at  timestamptz,
  admin_notes           text,

  -- 'website' for the form; 'backfill' for applications recorded after the
  -- fact (the two received before this table existed).
  source                text NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'backfill')),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT scholarship_offer_complete CHECK (
    status <> 'offered' OR (percent_off IS NOT NULL AND event_slug IS NOT NULL AND offer_token IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS scholarship_applications_status_idx ON public.scholarship_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS scholarship_applications_member_idx ON public.scholarship_applications (member_id);
CREATE INDEX IF NOT EXISTS scholarship_applications_registration_idx ON public.scholarship_applications (registration_id);
CREATE INDEX IF NOT EXISTS scholarship_applications_event_idx ON public.scholarship_applications (event_slug);
CREATE INDEX IF NOT EXISTS scholarship_applications_email_idx ON public.scholarship_applications (lower(email));

-- One live scholarship per registration: the checkout looks the coupon up by
-- registration, so two offers on one registration would be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS scholarship_applications_one_per_registration
  ON public.scholarship_applications (registration_id)
  WHERE registration_id IS NOT NULL AND status = 'offered';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scholarship_applications TO service_role;
ALTER TABLE public.scholarship_applications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access scholarship_applications"
    ON public.scholarship_applications FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER scholarship_applications_updated_at
    BEFORE UPDATE ON public.scholarship_applications
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Retrospective scholarships: the reimbursement ───────────────────────────
-- A student who registered and paid before applying gets back the difference
-- between the event fee they paid and the scholarship price (card refund, or
-- account credit). Those refunds are audited in event_refunds like any other,
-- tagged kind='scholarship' so the cancellation path — which refuses a second
-- refund for the same participant — doesn't mistake one for a cancellation.
ALTER TABLE public.event_refunds
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'cancellation';

DO $$ BEGIN
  ALTER TABLE public.event_refunds
    ADD CONSTRAINT event_refunds_kind_check CHECK (kind IN ('cancellation', 'scholarship'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Whether the registration had already been paid when the offer was made —
-- the retrospective case. Decides the wording of the offer emails (a refund,
-- not next steps); the refund itself is in event_refunds.
ALTER TABLE public.scholarship_applications
  ADD COLUMN IF NOT EXISTS registration_paid_at_offer boolean NOT NULL DEFAULT false;

-- At most one scholarship reimbursement per registration (the app also checks).
CREATE UNIQUE INDEX IF NOT EXISTS event_refunds_one_scholarship_per_registration
  ON public.event_refunds (registration_id)
  WHERE kind = 'scholarship' AND refund_type IN ('cash', 'credit');
