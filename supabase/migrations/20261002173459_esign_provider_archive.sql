-- E-signature provider seam, signed-record archive and routing state.
--
-- WHY (2 Oct 2026): the DocuSign plan allows 40 envelopes a month and September
-- used 23. Once the allowance is spent every further agreement fails and the
-- participant is left without paperwork. A second signing engine, built into
-- this app, takes agreements when DocuSign cannot, and replaces it when the
-- contract ends (about 6 Aug 2027). Plan: docs/PLAN-esign-2026-10-02.md.
--
-- This migration is the engine-independent half:
--   1. docusign_envelopes records WHICH engine issued each agreement.
--   2. Signed PDFs get a home in this app. Until now both download routes
--      fetched the document live from DocuSign on every request, so every
--      executed consent form would become unreachable the day the account
--      lapsed.
--   3. A retention date per record (7 years from signing, as the Privacy
--      Policy states) and a restriction flag for records kept after a
--      deletion request.
--   4. One row of routing state: which engine new agreements go to.
--   5. A log of who viewed or downloaded a signed record.
--
-- The tables keep their docusign_* names for now. Renaming them here would
-- break production between this migration and the code that follows it (the
-- promote step applies migrations first); the rename is a later, two-step
-- change behind compatibility views.
--
-- Additive and idempotent: safe to run twice.

-- ── 1. Which engine issued the agreement ─────────────────────────────────────
ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'docusign';

DO $$ BEGIN
  ALTER TABLE public.docusign_envelopes
    ADD CONSTRAINT docusign_envelopes_provider_check
    CHECK (provider IN ('docusign', 'native'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.docusign_envelopes.provider IS
  'Signing engine that issued this agreement: docusign, or native (the in-app engine). envelope_id is that engine''s own id.';

CREATE INDEX IF NOT EXISTS docusign_envelopes_provider_sent_idx
  ON public.docusign_envelopes (provider, sent_at DESC);

-- The membership agreement (signed by people who join without attending an
-- event) is a fifth agreement type. It is only ever issued by the native engine.
ALTER TABLE public.docusign_envelopes
  DROP CONSTRAINT IF EXISTS docusign_envelopes_envelope_type_check;
ALTER TABLE public.docusign_envelopes
  ADD CONSTRAINT docusign_envelopes_envelope_type_check
  CHECK (envelope_type IN ('minor', 'adult', 'mentor', 'volunteer', 'membership'));

COMMENT ON COLUMN public.docusign_envelopes.envelope_type IS
  'Agreement type: minor (parental consent), adult, mentor, volunteer, or membership agreement.';

-- ── 2. The signed record, stored here ────────────────────────────────────────
ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS signed_pdf_path        text,
  ADD COLUMN IF NOT EXISTS signed_pdf_sha256      text,
  ADD COLUMN IF NOT EXISTS certificate_path       text,
  ADD COLUMN IF NOT EXISTS archived_at            timestamptz,
  ADD COLUMN IF NOT EXISTS archive_attempts       int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archive_error          text,
  ADD COLUMN IF NOT EXISTS replicated_at          timestamptz,
  ADD COLUMN IF NOT EXISTS completion_notified_at timestamptz;

COMMENT ON COLUMN public.docusign_envelopes.signed_pdf_path IS
  'Object path of the executed PDF in the private signed-agreements bucket. Null until archived; coverage rows (reused_from) never have one.';
COMMENT ON COLUMN public.docusign_envelopes.signed_pdf_sha256 IS
  'SHA-256 of the stored PDF, hex. The stored object must still hash to this.';
COMMENT ON COLUMN public.docusign_envelopes.certificate_path IS
  'Object path of the engine''s audit record: DocuSign''s Certificate of Completion, or the native engine''s audit file.';
COMMENT ON COLUMN public.docusign_envelopes.archive_attempts IS
  'Failed archive attempts. The retry job stops at a cap so an envelope that no longer exists upstream is reported, not retried forever.';
COMMENT ON COLUMN public.docusign_envelopes.replicated_at IS
  'When the encrypted second copy of the signed record was last written off-database.';
COMMENT ON COLUMN public.docusign_envelopes.completion_notified_at IS
  'Set once the completion side-effects (emails, activity log) have run, so a replayed webhook cannot repeat them.';

-- The archive job's work list: signed, original (not a coverage row), not yet stored.
CREATE INDEX IF NOT EXISTS docusign_envelopes_unarchived_idx
  ON public.docusign_envelopes (completed_at)
  WHERE status = 'completed' AND reused_from IS NULL AND archived_at IS NULL;

-- ── 3. Retention ─────────────────────────────────────────────────────────────
ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS retain_until  timestamptz,
  ADD COLUMN IF NOT EXISTS restricted_at timestamptz;

COMMENT ON COLUMN public.docusign_envelopes.retain_until IS
  'When the signed record is deleted: 7 years after signing. Null until completed.';
COMMENT ON COLUMN public.docusign_envelopes.restricted_at IS
  'Set when the person asked for deletion, or their participant record was removed, before retain_until. The record is kept for legal claims only and is not shown or used.';

UPDATE public.docusign_envelopes
   SET retain_until = completed_at + interval '7 years'
 WHERE status = 'completed'
   AND completed_at IS NOT NULL
   AND retain_until IS NULL;

CREATE INDEX IF NOT EXISTS docusign_envelopes_retain_until_idx
  ON public.docusign_envelopes (retain_until)
  WHERE retain_until IS NOT NULL;

-- ── Close the default grants on the agreement tables ─────────────────────────
-- The baseline grants ALL on these to anon and authenticated, leaving row-level
-- security as the only barrier, and the anon key ships to every browser. Every
-- read and write goes through the service role, so nothing depends on them.
REVOKE ALL ON public.docusign_envelopes           FROM anon, authenticated;
REVOKE ALL ON public.docusign_envelope_recipients FROM anon, authenticated;

-- ── 4. Routing state ─────────────────────────────────────────────────────────
-- Exactly one row. `id` is a boolean primary key that can only be true.
CREATE TABLE IF NOT EXISTS public.esign_provider_state (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- docusign_only: never use the native engine (the safe default until it is
  --   proven in production).
  -- auto: DocuSign until its allowance is spent, then native until it resets.
  -- overflow_only: native for everything.
  mode               text NOT NULL DEFAULT 'docusign_only'
                     CHECK (mode IN ('auto', 'docusign_only', 'overflow_only')),
  monthly_cap        int NOT NULL DEFAULT 40 CHECK (monthly_cap >= 0),
  -- Envelopes held back from the cap, so two registrations racing for the last
  -- one do not both hit DocuSign's refusal.
  reserve            int NOT NULL DEFAULT 2 CHECK (reserve >= 0),
  -- Agreement types the native engine may take. Narrowing this is the cut line
  -- if a type is not ready on the native engine.
  overflow_types     text[] NOT NULL
                     DEFAULT ARRAY['minor', 'adult', 'mentor', 'volunteer', 'membership'],
  -- Signer emails always routed to the native engine, whatever the mode: the
  -- canary for testing in production before `auto` is switched on.
  overflow_allowlist text[] NOT NULL DEFAULT '{}',
  -- Set when DocuSign refuses for want of allowance; routing skips DocuSign
  -- until this passes.
  exhausted_until    timestamptz,
  exhausted_reason   text,
  -- What DocuSign's own account endpoint last reported. Includes envelopes sent
  -- from DocuSign's web UI, which a count of our rows cannot see.
  account_sent       int,
  account_allowed    int,
  account_period_end timestamptz,
  account_synced_at  timestamptz,
  updated_by         text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.esign_provider_state IS
  'Single row deciding which signing engine new agreements go to (lib/esign/routing.ts).';

INSERT INTO public.esign_provider_state (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.esign_provider_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.esign_provider_state FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.esign_provider_state TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access esign_provider_state"
    ON public.esign_provider_state FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. Who looked at a signed record ─────────────────────────────────────────
-- Append-only: service_role may insert and read, never change or remove.
CREATE TABLE IF NOT EXISTS public.esign_access_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  -- docusign_envelopes.id. Deliberately not a foreign key: the log must
  -- outlive the record it describes.
  envelope_row uuid NOT NULL,
  action       text NOT NULL CHECK (action IN ('view', 'download', 'certificate', 'export')),
  actor_type   text NOT NULL CHECK (actor_type IN ('admin', 'member', 'signer', 'system')),
  -- Clerk user id, member id or recipient row id, by actor_type.
  actor_id     text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.esign_access_log IS
  'Every view or download of a signed agreement: who, when, which record. Append-only.';

CREATE INDEX IF NOT EXISTS esign_access_log_envelope_idx
  ON public.esign_access_log (envelope_row, at DESC);

ALTER TABLE public.esign_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.esign_access_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.esign_access_log TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role append esign_access_log"
    ON public.esign_access_log FOR INSERT TO service_role
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "service role read esign_access_log"
    ON public.esign_access_log FOR SELECT TO service_role
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Private bucket for signed records ────────────────────────────────────────
-- Served only through short-lived signed URLs after an authorisation check
-- (mirrors teacher-licenses, migration 129).
INSERT INTO storage.buckets (id, name, public)
VALUES ('signed-agreements', 'signed-agreements', false)
ON CONFLICT (id) DO NOTHING;
