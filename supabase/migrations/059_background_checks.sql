-- Migration 059: Background checks & teacher licenses (PRD §13).
--
-- Adults who are not students (event_role NOT in school_student /
-- school_student_manager) and are 18+ must be cleared to take part, by EITHER:
--   • a teacher license they enter themselves (free text, manually admin-verified), OR
--   • a Certn (certn.co) background check Stellr orders on their behalf.
--
-- Two tables, both keyed to members:
--   member_teacher_licenses  — one current license per member (unique member_id);
--                              re-entering replaces the row and resets verification.
--   member_background_checks — one row per check ordered (history of re-screens);
--                              the newest by ordered_at is the member's current check.
--
-- Background-check validity is 3 years from completion (Stellr-enforced — Certn
-- documents no expiry); we stamp expires_at = completed_at + 3yr when a check
-- completes. Teacher-license validity is the expiry_date the teacher entered.
--
-- Conventions follow prior migrations: IF NOT EXISTS guards, gen_random_uuid()
-- PKs, RLS scoped TO service_role (everything goes through service-role server
-- routes, as with member_activity_log / community_post_reads).

-- ── Teacher licenses ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_teacher_licenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,

  -- All free text, entered by the teacher (PRD: license number / state / expiry).
  license_number  text NOT NULL,
  licensing_state text NOT NULL,
  expiry_date     date NOT NULL,

  -- Manual admin verification: Stellr confirms the documentation is correct.
  -- verified_at NULL = awaiting review; set = verified. verified_by is the
  -- reviewing admin's member row when known (admins may lack one), with a
  -- denormalised label snapshot so the record reads well if that row is removed.
  verified_at     timestamptz,
  verified_by     uuid REFERENCES public.members(id) ON DELETE SET NULL,
  verified_label  text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One current license per member; the self-service form upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS member_teacher_licenses_member_uidx
  ON public.member_teacher_licenses (member_id);

ALTER TABLE public.member_teacher_licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role all teacher_licenses" ON public.member_teacher_licenses;
CREATE POLICY "service_role all teacher_licenses" ON public.member_teacher_licenses
  TO service_role USING (true) WITH CHECK (true);

-- ── Background checks ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_background_checks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,

  provider            text NOT NULL DEFAULT 'certn',
  -- Certn application id / short_uid, set once the order is acknowledged.
  certn_application_id text,
  -- The request_* booleans we asked Certn for, echoed for the audit record.
  request_flags       jsonb NOT NULL DEFAULT '{}'::jsonb,

  --   invited      — Certn emailed the candidate; awaiting their submission
  --   in_progress  — submitted, Certn analysing
  --   passed       — complete, cleared (no issues)
  --   referred     — complete, flagged for human review / not cleared
  --   cancelled    — order cancelled before completion
  --   error        — order failed to place
  status              text NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited','in_progress','passed','referred','cancelled','error')),
  -- Raw Certn result label (e.g. CLEARED / REFERRED) alongside the mapped status.
  result              text,

  -- Who ordered it (admin). ordered_by is their member row when known; label is
  -- a denormalised snapshot.
  ordered_by          uuid REFERENCES public.members(id) ON DELETE SET NULL,
  ordered_label       text,
  ordered_at          timestamptz NOT NULL DEFAULT now(),

  completed_at        timestamptz,
  -- completed_at + 3 years, stamped on completion (Stellr-enforced validity).
  expires_at          timestamptz,

  report_pdf_url      text,
  -- Last webhook / poll payload, for debugging and audit.
  raw                 jsonb,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_background_checks_member_idx
  ON public.member_background_checks (member_id, ordered_at DESC);

CREATE INDEX IF NOT EXISTS member_background_checks_status_idx
  ON public.member_background_checks (status);

-- Webhook lookup: map an incoming Certn application id back to our row.
CREATE INDEX IF NOT EXISTS member_background_checks_certn_idx
  ON public.member_background_checks (certn_application_id);

ALTER TABLE public.member_background_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role all background_checks" ON public.member_background_checks;
CREATE POLICY "service_role all background_checks" ON public.member_background_checks
  TO service_role USING (true) WITH CHECK (true);

-- ── Activity-log category ─────────────────────────────────────────────────────
-- Add 'compliance' to member_activity_log.category so license/BC events file
-- under their own heading (mirrors lib/activity-log.ts ActivityCategory).
ALTER TABLE public.member_activity_log
  DROP CONSTRAINT IF EXISTS member_activity_log_category_check;
ALTER TABLE public.member_activity_log
  ADD CONSTRAINT member_activity_log_category_check
  CHECK (category IN ('membership', 'profile', 'account', 'event',
                      'billing', 'docusign', 'community', 'school', 'compliance'));
