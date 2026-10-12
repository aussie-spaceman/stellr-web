-- At most one cancellation refund per participant (deep review PAY-12).
--
-- executeRefund read event_refunds to decide "already refunded?" then created the
-- Stripe refund — a read-then-act with no idempotency key and no DB uniqueness.
-- A double-submitted delete (two admins, or a retry after the audit insert failed
-- mid-deletion) could refund the same participant twice. The cash path now also
-- passes an idempotencyKey, and this partial unique index is the DB backstop — the
-- exact shape the scholarship path already carries (migration 20261002181046).
--
-- cash/credit only (a 'none'/'manual_required' audit row is not a refund, and a
-- participant may legitimately have several of those). kind='cancellation' so a
-- scholarship reimbursement on the same participant is unaffected.

CREATE UNIQUE INDEX IF NOT EXISTS event_refunds_one_cancellation_per_participant
  ON public.event_refunds (participant_id)
  WHERE kind = 'cancellation' AND refund_type IN ('cash', 'credit');
