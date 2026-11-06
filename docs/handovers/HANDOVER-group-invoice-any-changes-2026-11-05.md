# Handover — group invoices: any number of changes (5 Nov 2026)

**On `dev`, not in production.** Promotion is in a separate session. The migration must reach production before the code.

Tracker: `docs/handovers/tracker/2026-11-05-group-invoice-any-changes.md` (rows `group-invoice-any-changes.1–.9`). People are named only in the Doc: `1C7r2rMRkTmgmG3rHHgg2n6XBqo1134O1nptzK8pD_mY`.

## Why

An automated alert on 5 Nov said the invoice for the Minnesota Environmental Design Challenge group (registration `0e416e3b-8a3d-4348-b1fb-88e4f3873ff9`) could not be updated. Stripe refuses a fifth invoice in a revision chain: "You cannot have more than 4 in a revision history, including the original invoice". Its documented list of revision constraints doesn't mention this.

| Time (UTC) | Change | Result |
|---|---|---|
| 15:00:30 | 18 → 17 | `2EFXPOSM-0004` issued, the fourth in the chain |
| 15:00:49 | 17 → 16 | Refused |
| 15:01:07 | 16 → 15 | Refused |
| 15:16:15 | 15 → 16 | Refused |
| 15:18:35 | 16 → 15 | Refused |

The seat counts moved on regardless, so the open invoice stayed at 17 places while the group was at 15. The alert's remedy was a dead end: "Invoice & discount…" had no reissue button, and applying a discount revises too, so it hit the same cap. David asked for the app to handle unlimited changes to a group registration and its invoicing, then for the emails to be batched and roster changes serialised.

## What shipped

**#554 → `dev` `82069215`.** Migration `20261105190000_group_invoice_sync.sql`, dev only.

All in `lib/group-billing.ts` unless noted:

- **Replacing an invoice.** `reviseGroupInvoice` still prefers Stripe's revision. If Stripe refuses and there is no draft revision to reuse, `replaceGroupInvoice` finalises a new invoice without emailing it, voids the old one, records it, then sends it. If the void fails (just paid, payment processing), the new invoice is voided instead, so an organiser never holds two payable invoices. Discount, due date and custom fields carry over.
- **`reissueGroupInvoice` and "Send corrected invoice".** `groupInvoiceSummary` reports `correction` when an unpaid invoice no longer matches the group; `components/admin/GroupInvoiceButton.tsx` shows the total and the button. A voided last invoice gets a new one.
- **Unpaid additional invoices.** `openAdditionalInvoiceFor`: someone removed while on one comes off that invoice. `lib/refunds/payment-basis.ts` treats that place as unpaid, so nothing is refunded from the group's main payment. Both removal callers now pass `participantIds`.
- **The quiet period.** `applyRosterChange` no longer touches Stripe for an unpaid invoice. It pushes `registrations.invoice_sync_due_at` forward by `INVOICE_SYNC_QUIET_MS` (2 minutes) and waits in `runAfterResponse`. Only the newest waiter finds it due. `syncGroupInvoice` compares the invoice with the current places, so changes that cancel out send nothing. It clears the due time only if it hasn't moved, so a change that arrives during an update still runs.
- **Backstop.** `app/api/cron/group-invoice-sync` runs daily (`syncDueGroupInvoices`). A failed update alerts staff and stays due, so the alert repeats daily until it is fixed. That is deliberate.
- **Paid during the wait.** Extra places get an additional invoice automatically. For places that came off, staff get an alert with the amount and no money moves, because the removed participants' rows are gone and a refund would have nothing to attach to.
- **Concurrency.** `writeCounts` is compare-and-set, and `applyRosterChange` re-plans on a lost race. `withInvoiceLock` is a lease on `invoice_sync_lock_until` that expires by itself; admin changes take it too.

## Worth knowing

- **Read Stripe errors by `e.type === 'StripeInvalidRequestError'`, not `instanceof`.** In the test-mode drill a real refusal failed `instanceof` while the mocks passed. Only the drill caught it.
- `loadRegistration`'s columns deliberately leave out the new fields, so refunds don't depend on the migration. Scheduling and the lock do.
- `audit-cap-grow` did not exist as a label and had to be created. CI reads it by name.
- `lib/file-sniff.test.ts` "reads a calendar of millions of lines" failed once on timing under a full local run, then passed. Unrelated to this work.

## Verified

Stripe test mode and the dev database; drill data removed and read back as gone:

- 9 removals, a correction and a discount change past the cap: 12 invoices across 3 chains, one open at every step, every total correct.
- 4 simultaneous removals freed all 4 places. A burst of 5 changes with the real 2-minute wait sent 1 invoice and nothing early.
- Two simultaneous jobs: the lock admitted one. Paid during the wait, through `syncDueGroupInvoices`: additional invoice raised.
- 2 removals through the real admin delete route on a local dev server: 1 invoice after the wait.
- The dialog, clicked through in a browser on dev.
- CI on #554: every step passed, including `Unit tests`, `npx playwright test` in `e2e-tests` and `e2e-local`, and `pgTAP tests`. The push to `dev` reported success, and the dev deployment is READY.

## Not verified

- The 2-minute wait on Vercel (`.4`), and the cron route over HTTP (`.5`).
- Against real Stripe: removal from an unpaid additional invoice, the "places came off" alert, and an invoice paid while it is being replaced (`.6`). Unit tests only.
- Nothing has run in production.

## Session slip

During the first drill's cleanup I ran `pkill -f "next dev"`, which stops every local Next dev server on the machine, not just this session's. David was told. Later cleanups killed only the one port.

## Next

1. `.1` promote: migration first.
2. `.2` **HIGH**: "Send corrected invoice" on the Minnesota group. Until then the organiser can overpay by $164.90.
3. `.3` David decides on a line to the organiser.
4. `.4` and `.5` at the first real roster change and the next day's cron.
5. `.6` and `.7` when they come up.
