# Handover: group payment options — 2026-11-09

Slug `group-payment-options`. Tracker: `tracker/2026-11-09-group-payment-options.md`. Spec and every edge case: `docs/PLAN-group-payment-options-2026-11-09.md`.

**Not promoted.** #584 is on `dev` as `5c1aa93a`. Promotion is a separate session, and both migrations must reach production before the code does.

## Why

A teacher whose group had just moved from invoice to individual payment (#573) asked for an invoice for herself only, her students paying by their own links. The owner also wanted a second option: students share the teacher's cost through their own links. Owner decisions are recorded in the spec (shortfall absorbed by Stellr, true-up the day after the event, a teacher added folds in only before the first payment, scholarship students pay the share, leaving refunds shares, later joiners per a group setting, presets plus per-person ticks on the public form).

## What changed

**Invoice for some**
- `participants.payer` (`group` / `self` / `shared`) and `registrations.late_joiner_payer`. A split group has `invoice_requested` true, `member_pays_individually` false and `late_joiner_payer` set (`isSplitGroup`, `payerOf`, `seatsOnInvoice` in `lib/group-payer.ts`). NULL payers keep the old meaning; no backfill.
- Invoice seats = named group payers + unfilled places when later joiners go on the invoice. Every invoice path uses `invoiceSeatCount` (`lib/group-billing.ts`).
- `lib/group-payment-change.ts`: `invoice_some` method. Moving people on or off an open invoice queues a revision (`queueInvoiceSync`) instead of void-and-reissue. Open seat checkouts of people who keep paying by link are left alone.
- A `pending` own link reads as owed everywhere (`lib/payment-status.ts`), and the readers that branched on `member_pays_individually` (Teams, Billing, outstanding banner, pay-seat routes, refunds basis, Finish setup) now handle split groups.

**Students share the teacher's cost** (`lib/teacher-share.ts`)
- A sharing group is individually paid with `share_estimate` set. Covered adults: payer `shared`, status `covered`.
- Pool = covered adults × `share_unit_cents`. Share = floor(pool ÷ max(estimate, students)); `share_cents` only goes down after `share_first_paid_at`. `refreshShare` runs after every roster change, every `ensureIndividualPayments`, and every checkout.
- Seat pay page takes the code; `createSharedSeatCheckout` sends two `price_data` lines. The webhook stores the split (`recordSeatShare`). Account → Billing / Teams "Pay now" redirect to the seat pay page for these groups.
- `settleDueShares` runs in the daily `group-invoice-sync` cron: true-up refunds (`event_refunds.kind = 'share_true_up'`), then `share_settled_at`. Leaving the option calls `unwindShares` (`share_unwind`).
- Refund basis for these seats = `base_paid_cents + share_paid_cents`.

**Surfaces:** public form (two new choices, tick list, estimate), "How this group pays" dialog (tick list, later-joiner setting, estimate, share summary; staff also see the shortfall), seat pay page breakdown, roster pill "Shared by Students".

## Verified

- CI on #584: build, typecheck, design-system lint, unit, both Playwright suites (steps read, not badges).
- Unit: the plan's worked example ($24.25 → $19.40 → $4.85 back each), split and shared change flows, registration branches.
- Public form, both new choices, at 390px headlessly.
- Both migrations applied to dev; ledger realigned to the filenames.

## Not verified

- Any real Stripe call on the new paths (`.2`, `.3`). Dev events can't read their live price with the test key, so the dialog is blocked and the pay page shows the plain flow on dev.
- Dialog Confirm in a browser (`.4`).
- First production settlement (`.9`).

## Open

See the tracker. Most important: `.1` promote with both migrations first; `.2` test-mode drill; `.5` and `.6` move and reply to the group that asked (names in the Doc).
