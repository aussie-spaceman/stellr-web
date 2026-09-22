-- Adjudication of a flagged ("Consider") background check.
--
-- A Consider result means Checkr found records; it does NOT mean the person is
-- disqualified. Someone has to look at what was found and decide whether it
-- disqualifies them from working with minors. Until 22 Sept 2026 Stellr had
-- nowhere to record that decision: the check sat at status='referred' for ever,
-- the member read as a plain red "Invalid" indistinguishable from someone who
-- had never been ordered, and nothing recorded who decided what, when, or why.
-- For an FCRA-relevant decision that is the wrong place to keep no record.
--
-- `status` is NOT touched by adjudication. It continues to mirror the vendor's
-- report status exactly — that equivalence is the Checkr certification pass
-- criterion. The adjudication is a separate Stellr-side layer that
-- deriveCompliance reads on top of it.
--
-- provider_adjudication mirrors Checkr's own `adjudication` field
-- (engaged / pre_adverse_action / post_adverse_action) so our record and theirs
-- can be compared.

ALTER TABLE public.member_background_checks
  ADD COLUMN IF NOT EXISTS adjudicated_at        timestamptz,
  ADD COLUMN IF NOT EXISTS adjudicated_by        uuid REFERENCES public.members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adjudicated_label     text,
  ADD COLUMN IF NOT EXISTS adjudication_outcome  text,
  ADD COLUMN IF NOT EXISTS adjudication_notes    text,
  ADD COLUMN IF NOT EXISTS provider_adjudication text;

DO $$ BEGIN
  ALTER TABLE public.member_background_checks
    ADD CONSTRAINT member_background_checks_adjudication_outcome_check
    CHECK (adjudication_outcome IS NULL OR adjudication_outcome IN ('cleared', 'not_cleared'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- An outcome without a timestamp (or the reverse) would be a half-written
-- decision; refuse both halves rather than let a partial record look complete.
DO $$ BEGIN
  ALTER TABLE public.member_background_checks
    ADD CONSTRAINT member_background_checks_adjudication_complete_check
    CHECK ((adjudicated_at IS NULL) = (adjudication_outcome IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The audit page asks "which flagged checks are still waiting on a human?" on
-- every load.
CREATE INDEX IF NOT EXISTS member_background_checks_awaiting_adjudication_idx
  ON public.member_background_checks (member_id)
  WHERE status = 'referred' AND adjudicated_at IS NULL;

COMMENT ON COLUMN public.member_background_checks.adjudication_outcome IS
  'Stellr''s decision on a flagged report: cleared = may participate despite the records found; not_cleared = may not. NULL = nobody has decided yet.';
COMMENT ON COLUMN public.member_background_checks.provider_adjudication IS
  'Checkr''s own adjudication field (engaged / pre_adverse_action / post_adverse_action), for comparison with ours.';
