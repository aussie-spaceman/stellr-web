-- Signed agreements survive the deletion of the participant they belong to.
--
-- WHY (2 Oct 2026): docusign_envelopes.participant_id was ON DELETE CASCADE, so
-- deleting a participant from an event roster silently deleted their signed
-- consent form's row with it. The retention rule (7 years from signing,
-- Privacy Policy §10) needs the signed record to outlive the roster entry.
--
-- The application decides what happens to each row before the participant is
-- deleted (lib/esign/retention.ts): signed agreements are restricted and kept;
-- unsigned ones are removed. With SET NULL here, the kept rows are simply
-- unlinked instead of cascaded away.
--
-- Idempotent: re-running drops and re-adds the same constraint.

ALTER TABLE public.docusign_envelopes
  DROP CONSTRAINT IF EXISTS docusign_envelopes_participant_id_fkey;

ALTER TABLE public.docusign_envelopes
  ADD CONSTRAINT docusign_envelopes_participant_id_fkey
  FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.docusign_envelopes.participant_id IS
  'Event participant this agreement was issued for. Null for member-level agreements (volunteer, membership) and for signed agreements kept after the participant was deleted (see restricted_at).';
