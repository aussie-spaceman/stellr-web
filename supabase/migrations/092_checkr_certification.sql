-- Migration 092: Checkr API-certification hardening (PRD §13).
--
-- Checkr's production-authorization review requires the integration to handle
-- the full report lifecycle, not just clear/consider:
--   * "Assess" support — report.completed carries an `assessment` tag that must
--     take precedence over the raw `result`. We persist it for audit/replay.
--   * "Complete Now"/Report Lifecycle — a report can complete with one or more
--     screenings canceled (`includes_canceled = true`), or be fully canceled
--     (report.canceled). We persist the canceled indicator and add terminal
--     `expired` (invitation.expired) to the status vocabulary.
-- No real check rows exist in prod yet, so this is purely additive.

ALTER TABLE public.member_background_checks
  ADD COLUMN IF NOT EXISTS assessment       text,
  ADD COLUMN IF NOT EXISTS includes_canceled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.member_background_checks.assessment IS
  'Checkr Assess tag (eligible / review / escalated) — takes precedence over result.';
COMMENT ON COLUMN public.member_background_checks.includes_canceled IS
  'True when a completed report contained one or more canceled screenings (Complete Now).';

-- Widen the status CHECK to admit the invitation-expired terminal state.
ALTER TABLE public.member_background_checks
  DROP CONSTRAINT IF EXISTS member_background_checks_status_check;
ALTER TABLE public.member_background_checks
  ADD CONSTRAINT member_background_checks_status_check
  CHECK (status IN ('invited','in_progress','passed','referred','cancelled','expired','error'));
