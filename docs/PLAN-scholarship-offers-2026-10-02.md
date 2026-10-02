# Scholarship offers — plan, build and backfill runbook (2 Oct 2026)

**Status:** built on `feat/scholarship-offers`, verified against the dev
project; not yet shipped. Migration `20261002181046_scholarship_applications`
is applied to **dev only**.

## Why

Before this, a scholarship application was an email to `hello@` and a HubSpot
lead (name and email only — the brief lived only in the email). There was no
row, no review screen, nothing on the roster or member page, and offers went out
as hand-written emails quoting a shared, reusable promotion code
(`SCHOLARSHIP100` / `SCHOLARSHIP50`) that works on any event checkout.

## Owner decisions (2 Oct 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Backfill emails for Shreyas Shankar (Colorado, event 3 Oct) | **No automatic emails** — he registers before this deploys. Record only. Ethan Lawrence stays in scope. |
| 2 | Ethan already had a pending registration | Attach the scholarship to it; no new registration. |
| 3 | Levels | Four Stripe coupons: `SCHOLARSHIP33`, `SCHOLARSHIP50`, `SCHOLARSHIP67`, `SCHOLARSHIP100`. |
| 4 | Who reviews | **Admins only** (not event managers). |
| 5 | Whose email | The application email is the **student's** email. |
| 6 | Email timing | All three offer emails at once. |
| 7 | Acknowledgement / decline / expiry | Ack only if HubSpot doesn't already send one — it doesn't (neither applicant contact has ever been sent an email), so the app sends it. No decline email. No expiry. |
| 8 | Registered **and paid** before applying | Reimburse the difference; apply the scholarship to the existing registration and the member's history (added the same day). |
| 9 | How to reimburse | Card refund by default; the reviewer can choose account credit instead. |
| 10 | What the % applies to | The event fee only — merch add-ons untouched; any discount code already used is netted off. |
| 11 | Emails for an already-paid student | Email 1 with the reimbursement line, plus a consent-form reminder only if their DocuSign is unsigned. No payment email. |
| 12 | Students on a group registration | Still blocked — the school/teacher paid; handle manually. |

## What was built

**Data** — `scholarship_applications` (one row per application). `status`
stores only the decision: `submitted | offered | not_offered | withdrawn`.
Progress after an offer is *derived* from the linked registration
(`lib/scholarship-levels.ts` `scholarshipStage`):

| Stage | Meaning |
|---|---|
| `awaiting_details` | offered; no (live) registration yet |
| `awaiting_payment` | registration pending |
| `confirmed` | registration confirmed — **accepted** |
| `attended` | confirmed and checked in |

**Intake** (`app/api/scholarship/route.ts`) — zod validation with length caps;
the row is saved first (fail open: staff still emailed if the insert fails);
the staff email is HTML-escaped (closes the open item in
`docs/REC-form-spam-hardening.md`) and carries a **Review application** link;
the applicant gets an acknowledgement. The chosen activity title is resolved to
the Sanity event server-side, so the form is unchanged.

**Review** (`/admin/scholarships`, `/admin/scholarships/[id]`, nav: Members →
Scholarships) — choose event → member (suggested by same email, by the
application email being their emergency contact, or by name; or create new) →
level, then **Offer & register** with a confirm step that states who is
emailed, what they pay, and whether an existing registration is reused. Also
**Not offered** (no email), **Resend offer emails**, reviewer notes. The page
flags any level whose Stripe coupon can't be resolved.

**"Registered"** follows the mentor precedent (#181): the member row exists at
once; the student completes their own details. The *registration row* is created
by the ordinary individual form when they do — a participant row requires DOB,
gender, school etc., and every roster/CSV/badge reader relies on that. Until
then the roster lists the student under "Scholarship offers — awaiting
registration details".

**The three emails** (`lib/scholarship-emails.ts`, sent by
`lib/scholarship-offer.ts`), to the application email and the linked member's
email:
1. Congratulations + summary of the next steps.
2. Complete your registration → `/register/<slug>/individual?scholarship=<token>`
   (form prefilled, banner shows the discount). DocuSign goes out from the
   normal registration path. If details are already in (Ethan), this becomes
   "your details are in — make sure the consent form is signed".
3. Payment link → `/scholarship/offer/<token>`, a page that always shows the
   next step (details → pay → registered). Not sent for 100%.

**Payment** — `createRegistrationCheckout` looks up the offer on the
registration and pre-applies the level's **coupon** (`discounts`), dropping the
promotion-code box (Stripe rejects both together). The code is resolved as a
coupon id, else as a promotion code (active or not), and refused if its
percentage is off by ≥1 point — the checkout **fails closed** and alerts admins
rather than charging full price. Every pay path (form, pay link, billing tab,
admin "Send pay link") goes through it. A scholarship registration may pay after
registration closes. 100%: confirmed on submit with no Stripe step
(`lib/registration-confirm.ts`, moved unchanged out of the webhook).

**Retrospective scholarships — registered and paid first** (`lib/scholarship-refund.ts`).
On "Offer & register", a confirmed registration is reimbursed:

    refund = event fee actually paid − fee at the scholarship price   (≥ 0)

"Actually paid" is the event-fee line of the student's Stripe checkout
(`checkout.sessions.list({payment_intent})` → `listLineItems`), so a code
already used (`SCHOLARSHIP50`) is netted off — no double refund — and merch is
excluded. Falls back to the charge capped at one fee if the checkout can't be
read; always capped by what Stripe says is still refundable.
- Card refund: `stripe.refunds.create` with `metadata.source='stellr_app'` (the
  `charge.refunded` webhook ignores it) and idempotency key
  `scholarship-refund-<application id>`; guarded by `assertLiveCredentials`.
- Account credit: `account_credits` row, `source_type='scholarship'`, no expiry.
- Audited in `event_refunds` with the new `kind='scholarship'`. The cancellation
  path (`lib/refunds/execute.ts`, `preview.ts`) now only treats
  `kind='cancellation'` rows as "already refunded", so cancelling a scholarship
  student later still refunds what is left under the policy.
- Can't move the money (invoice, no Stripe price, Stripe unreachable, refund
  failed): audited as `manual_required`; the decision panel says why and offers
  **Retry reimbursement** (card or credit).
- The review panel quotes the reimbursement before confirming
  (`GET …/refund-quote`) and offers card / credit.
- `scholarship_applications.registration_paid_at_offer` records the case, so the
  emails report the reimbursement instead of next steps.
- A registration can carry only one live scholarship; a second offer is refused
  with a clear message (it used to fail silently on the unique index).
- Shows on the roster badge ("Scholarship · 50% · $82.50 reimbursed"), the admin
  member page and the student's Account page.

**Visibility** — roster badge "Scholarship · N%", a Scholarship filter and
"N on scholarship" count; admin member page and the student's Account page get a
Scholarships section (history is kept: accepted and past offers stay listed).

**Copy** — `/scholarship` no longer promises "the full participation fee"
(consistent with the 1 Sept change on `/impact`): "up to the full cost".

## Verified (dev, 2 Oct)

- Form → row saved, event resolved, staff email escaped with review link, ack sent.
- Admin review → offer 50% (new member) → 3 emails; offer 100% → 2 emails.
- Bad token refused; good token → registration created and linked to the same
  member (DOB filled), DocuSign sent; 100% → `confirmed` with nothing to pay.
- Roster badge/filter/count, admin member section, Account section (via view-as).
- Stripe (test mode, direct): 50% coupon on $165 → $82.50; 100% → a valid $0
  session (so `SCHOLARSHIP100` checkouts work today); `discounts` +
  `allow_promotion_codes` → rejected, as the code assumes.
- Unit: 1027 tests pass (new: levels/stage, emails, checkout scholarship cases,
  pay-after-close).

Retrospective case (round 2, same day):
- Unit: 15 refund tests (netting off a code already used, merch excluded,
  Stripe cap, checkout-unreadable fallback, unreadable price → manual not
  "free", invoice/no-PI/pending, cash/credit/failure/idempotency) + 4 email
  tests + cancellation-path test that a scholarship refund doesn't block it.
  1048 total pass.
- Stripe test mode, the exact calls: the fee line after a 50% coupon reads
  $82.50 (and an unrestricted coupon took the $15 shirt to $7.50 — the merch
  caveat below is real); a refund retried with the same idempotency key
  returned the same refund; the charge then showed $82.50 refunded.
- Dev UI: a confirmed, paid registration → review panel shows the
  reimbursement box → offer → decision records it (manual in dev — see below),
  2 emails (congratulations with the reimbursement line + consent reminder),
  Retry reimbursement present, roster badge.

Not verifiable in dev: a real event checkout with the discount. Sanity events
carry **live** price ids, which the dev test key cannot read, so dev cannot
build any event checkout (fee previews fall back to the code). Prove it in prod
with Ethan's payment.

The cash refund through the app could not run end to end in dev for the same
reason: the event fee can't be read, so the quote is (correctly) "manual".

## Backfill runbook (prod, after promote)

1. Confirm the four **live** coupons/promotion codes exist and are 33/50/67/100%.
   The review page shows a red note on any level that doesn't resolve.
2. Insert the two application rows (SQL kept out of the repo — it holds the
   applicants' personal circumstances; idempotent).
3. **Ethan** — Scholarships → Ethan Lawrence → event *Nevada Space Design
   Challenge* → member *Ethan Lawrence* (suggested: "application email is their
   emergency contact") → **50%** → the panel should say "Already registered
   (unpaid, $165.00 due)" → Offer & register (3 emails). **If he has paid by
   then** (likely with `SCHOLARSHIP50`), the panel instead says "already
   registered and paid" and the reimbursement box should read "nothing to
   reimburse" ($82.50 paid = the 50% price); he then gets 1–2 emails. Check: registration
   `26b91fee…` `amount_due_cents` = 8250; emails reached `inbalwal@gmail.com`
   and `ethanlawrence2011@gmail.com`.
4. **Shreyas** — first confirm his Colorado registration exists (his mum said
   they would register on 2 Oct with `SCHOLARSHIP100`). Scholarships → Shreyas
   Shankar → *Colorado Space Design Challenge* → his member → **100%** →
   **untick "Email … now"** → Offer & register. Record only. A `SCHOLARSHIP100`
   checkout leaves no payment intent, so the reimbursement box reads "No card
   payment on record — nothing to reimburse". If he paid full price, it will
   offer to refund $75 — decide then.
5. Send the two Gmail drafts (in each family's thread).
6. Switch off the public `SCHOLARSHIP*` **promotion codes** in Stripe (keep the
   coupons — the app applies those directly).

## Open items / risks

- **Merch add-ons**: a coupon applies to the whole checkout unless restricted to
  the event-fee product in Stripe, so a scholarship also discounts paid add-ons
  (seen in test mode: $15 shirt → $7.50 at 50%). The retrospective refund is
  fee-only, so the two paths treat merch differently until the coupons are
  restricted to the fee products.
- **First live scholarship refund** is unproven; the first already-paid offer in
  prod should be checked in the Stripe dashboard (refund metadata
  `kind=scholarship`) and in `event_refunds`.
- **No "withdraw offer" action**: the status exists; if needed, set it in SQL and
  reset the registration's `amount_due_cents`.
- **Shreyas's checkout today** is the first $0 event checkout in prod. The webhook
  confirms on `checkout.session.completed` without checking `payment_status` and
  `capturePaymentIntent` no-ops without a payment intent, so it should confirm.
- Dev data: two test applications (`scholarship-e2e-1002/1003@example.com`) with
  members, registrations and DocuSign demo envelopes on Nevada. Test-mode coupons
  `SCHOLARSHIP33/50/67/100` were created in Stripe test mode.
