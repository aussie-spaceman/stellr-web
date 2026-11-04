-- Minor self-registration: the pending guardian-consent state (decision 24,
-- 3 Nov 2026; plan S1). Read and written by lib/pending-consent.ts.
--
-- A member aged 13–17 who registers themselves, or a child under 13, finishes
-- onboarding with one row here. Until consented_at is set:
--   • 13–17 ('teen'): read-only on community — no posting, chat, reactions,
--     uploads, Space joins, directory listing or mentions;
--   • under 13 ('child'): the account stays inactive; only first name, date of
--     birth and the parent's email are kept on the member row.
-- The parent or guardian signs the Student / Minor agreement on Stellr
-- signing; its completion sets consented_at (lib/esign/completion.ts). A row
-- still unconsented at purge_after (30 days) is deleted with its member, Clerk
-- login included, through the deletion registry (pending_consent_member).
--
-- The row is kept after consent as the record of when consent was given; it
-- goes with the member (ON DELETE CASCADE).
--
-- Service-role only, like every member table: RLS on with no policies, and an
-- explicit GRANT so an MCP-applied migration leaves it readable by the app.

CREATE TABLE IF NOT EXISTS public.member_pending_consent (
  member_id      uuid PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  band           text NOT NULL CHECK (band IN ('teen', 'child')),
  guardian_name  text,
  guardian_email text NOT NULL,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  last_sent_at   timestamptz,
  consented_at   timestamptz,
  purge_after    timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.member_pending_consent IS
  'Self-registered minors awaiting a parent or guardian''s consent (decision 24). Unconsented rows past purge_after are purged with their member.';

-- The daily purge reads unconsented rows by due date.
CREATE INDEX IF NOT EXISTS member_pending_consent_purge_idx
  ON public.member_pending_consent (purge_after)
  WHERE consented_at IS NULL;

ALTER TABLE public.member_pending_consent ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.member_pending_consent FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_pending_consent TO service_role;
