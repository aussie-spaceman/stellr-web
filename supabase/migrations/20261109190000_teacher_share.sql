-- Students share the teacher's cost (9 Nov 2026).
--
-- A group can choose to have its teachers pay nothing directly: each student's
-- pay link carries an equal share of the teachers' full price. The share can only
-- go down as students join, and is settled the day after the event, when anyone
-- who paid a higher share gets the difference back (lib/teacher-share.ts).
--
-- registrations:
--   share_estimate       the teacher's estimate of how many students will come;
--                        set only on a group that shares the teacher's cost
--   share_unit_cents     a teacher's full price when the group chose this
--   share_cents          the live share per student (only ever goes down once a
--                        student has paid)
--   share_first_paid_at  when the first student paid a share
--   share_settled_at     when the share was settled after the event
-- participants:
--   base_paid_cents      what they paid for their own place (after any code)
--   share_paid_cents     what they paid toward the teacher's cost
--   discount_code        the code they used, if any
--   individual_payment_status gains 'covered': a teacher whose place the
--   students' shares pay for.
-- event_refunds.kind gains 'share_true_up' (settlement) and 'share_unwind' (the
-- group stopped sharing the teacher's cost).
--
-- Idempotent: safe to re-run under the CLI or the Supabase MCP.

ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS share_estimate integer;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS share_unit_cents integer;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS share_cents integer;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS share_first_paid_at timestamptz;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS share_settled_at timestamptz;

ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS base_paid_cents integer;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS share_paid_cents integer;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS discount_code text;

ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_share_estimate_check;
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_share_estimate_check CHECK (share_estimate IS NULL OR share_estimate >= 1);

ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS participants_individual_payment_status_check;
ALTER TABLE public.participants
  ADD CONSTRAINT participants_individual_payment_status_check
  CHECK (individual_payment_status IN ('pending', 'paid', 'waived', 'covered') OR individual_payment_status IS NULL);

ALTER TABLE public.event_refunds DROP CONSTRAINT IF EXISTS event_refunds_kind_check;
ALTER TABLE public.event_refunds
  ADD CONSTRAINT event_refunds_kind_check CHECK (kind IN ('cancellation', 'scholarship', 'share_true_up', 'share_unwind'));

-- The daily sweep finds groups to settle through this.
CREATE INDEX IF NOT EXISTS registrations_share_unsettled_idx
  ON public.registrations (event_slug)
  WHERE share_estimate IS NOT NULL AND share_settled_at IS NULL;
