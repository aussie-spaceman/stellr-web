-- A signer's email can now be corrected on a live agreement (the admin
-- "Correct email" action), and Stellr signing records that in its audit trail.
-- Adds 'corrected' to the events the trail accepts. The list is otherwise
-- unchanged from 20261002180802_esign_native_engine.sql.

ALTER TABLE public.esign_audit_events
  DROP CONSTRAINT IF EXISTS esign_audit_events_event_check;

ALTER TABLE public.esign_audit_events
  ADD CONSTRAINT esign_audit_events_event_check CHECK (event IN (
    'issued', 'invite_sent', 'viewed', 'consented', 'attested',
    'field_completed', 'signed', 'declined', 'countersigned',
    'sealed', 'completed', 'voided', 'reminded', 'downloaded',
    'restricted', 'archived', 'corrected'));
