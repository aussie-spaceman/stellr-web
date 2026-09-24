# Handover — refunds made in Stripe, and "No refund — remove only" (23 Sept 2026)

## Why
Daksha Rayana (Colorado Space Design Challenge) was refunded in full by hand in
the Stripe dashboard. The app never heard about it: no webhook handled refunds,
and "already refunded" only read `event_refunds`. Deleting her registration
would have issued a second refund (an 18.75 USD account credit), with no error
anywhere. The dialog also had no way to delete without refunding.

## What changed
- **Stripe is asked before any refund** (`lib/refunds/stripe-state.ts`), in both
  the preview and `executeRefund`.
  - Full refund: nothing further issued; audited as `refund_type 'none'`,
    `source 'stripe_external'`.
  - Partial refund: cash/credit capped at what is left on the charge.
  - Stripe unreachable: falls back to the database, as before.
- **"No refund — remove only"** (`refundChoice: 'none'`) in the delete dialog,
  per participant and per group. A reason is required (route returns 400
  without one); it is kept in `event_refunds.note` and the activity log
  (`refund_waived`). Nothing is pre-selected any more; group delete no longer
  defaults to credit.
- **`charge.refunded` webhook** (`lib/refunds/stripe-webhook.ts`) records
  dashboard refunds against the participant (or, for a group payment, the
  registration). Idempotent on `stripe_refund_id`. The app's own refunds carry
  `metadata.source = 'stellr_app'` and are skipped. It records only — it does
  not withdraw the registration or change payment status.
- **Roster**: "Refunded X in Stripe" line under the payment pill.
- **Dialog** now reports `manual_required` refunds instead of closing silently.
- Fixes: prior-refund lookup used `.maybeSingle()` (two rows → read as not
  refunded); a failed `account_credits` insert was reported as issued.

## Migration
`20260923120000_event_refunds_source_note.sql` — `source`, `note`, `currency`
columns + unique index on `stripe_refund_id`. **Applied to dev** (ledger
realigned to the filename). **Production: apply in `promote`, before merge.**
Dev had no duplicate `stripe_refund_id`s; production could not be checked from
the session (production reads blocked) — check before applying:
`select stripe_refund_id, count(*) from event_refunds where stripe_refund_id is not null group by 1 having count(*) > 1;`

## Closed (24 Sept 2026)
1. `charge.refunded` added to the production Stripe webhook endpoint (maintainer). Not yet exercised
   by a real dashboard refund; the first one should add a `stripe_external` cash row and a roster line.
2. The dialog was first exercised live on Daksha's removal (below), which also closes the browser-check gap
   for the external-full path. The partial-refund and "No refund" paths are not yet used live.
3. Daksha removed 24 Sept 15:26Z. The Stripe check detected the manual refund, and one `event_refunds` row
   was written (`none`, `stripe_external`, 0 cents, note "Refunded 75.00 USD in Stripe outside the app —
   Refunded in full in Stripe"). No account credit was issued.

Production migration applied 23 Sept before the #168 merge; `db:status --prod` clean for it.
