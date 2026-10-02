-- Privacy requests: a member, or a parent or guardian, asks to review their
-- (or their child's) information, have it deleted, or withdraw a consent.
-- (docs/PLAN-esign-2026-10-02.md, Phase 3: "guardian request flow for review,
-- deletion and withdrawal, verified by emailed link".)
--
-- A request counts only once the requester has followed the link emailed to
-- the address they gave; until then it is 'unverified' and nobody acts on it.
-- Unverified requests are deleted after 30 days; handled ones are kept three
-- years as the record that a request was answered.

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  kind               text NOT NULL CHECK (kind IN ('review', 'deletion', 'withdrawal', 'correction')),
  relationship       text NOT NULL CHECK (relationship IN ('self', 'parent_guardian')),
  requester_name     text NOT NULL CHECK (length(requester_name) BETWEEN 1 AND 120),
  requester_email    text NOT NULL CHECK (length(requester_email) BETWEEN 3 AND 254),
  subject_name       text CHECK (subject_name IS NULL OR length(subject_name) <= 120),
  details            text CHECK (details IS NULL OR length(details) <= 2000),
  status             text NOT NULL DEFAULT 'unverified'
                     CHECK (status IN ('unverified', 'verified', 'in_progress', 'completed', 'refused')),
  token_version      int NOT NULL DEFAULT 1,
  verified_at        timestamptz,
  verified_ip        text,
  handled_by         text,
  handled_at         timestamptz,
  resolution_note    text CHECK (resolution_note IS NULL OR length(resolution_note) <= 2000),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.privacy_requests IS
  'Requests to review, delete, correct or withdraw consent for personal data, confirmed by an emailed link (lib/privacy-requests.ts). Unverified ones deleted after 30 days; handled ones kept 3 years.';

CREATE INDEX IF NOT EXISTS privacy_requests_status_idx ON public.privacy_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS privacy_requests_email_idx ON public.privacy_requests (lower(requester_email), created_at DESC);

ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.privacy_requests TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role full access privacy_requests"
    ON public.privacy_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
