-- Migration 031: DocuSign 3-year validity / cross-event reuse
-- Signed paperwork is valid for 3 years and carries across events. When a
-- returning member registers and already has a completed agreement of the
-- required type on their profile, registration records a "coverage" row
-- pointing at the original signed envelope instead of issuing a new one.
-- Coverage rows have status 'completed', a synthetic envelope_id
-- ('on-file:<uuid>' — never a real DocuSign GUID), completed_at copied from
-- the source envelope (so expiry tracks the original signature date), and
-- reused_from set to the source row.

ALTER TABLE public.docusign_envelopes
  ADD COLUMN IF NOT EXISTS reused_from uuid
    REFERENCES public.docusign_envelopes(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.docusign_envelopes.reused_from IS
  'When set, this participant was covered by the referenced previously signed envelope rather than a newly issued one. envelope_id is synthetic (on-file:<uuid>) on such rows. Cascades on delete: removing the source paperwork removes its coverage records.';

-- Validity lookup: newest completed envelope of a given type for a member.
CREATE INDEX IF NOT EXISTS docusign_envelopes_member_valid_idx
  ON public.docusign_envelopes (member_id, envelope_type, completed_at DESC)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS docusign_envelopes_reused_from_idx
  ON public.docusign_envelopes (reused_from);
