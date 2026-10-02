# Handover — Scholarship offers (2 Oct 2026)

Slug `scholarship-offers`. Tracker: `tracker/2026-10-02-scholarship-offers.md`.
Spec, decisions, and backfill runbook: `docs/PLAN-scholarship-offers-2026-10-02.md` (on `dev` and `main`).

## Shipped
- **#267** squash-merged to `dev` as `641d5bb`. Promoted in **#270** as `139b94c`. The merge commit is pinned to `df213de`.
- Production deployment `dpl_GtS7Fc8mj18T59hMQTMj31wNhUwt`, ready 19:20:48Z.
- Rollback target: `dpl_BKHKZerVyZGooducgDgocovkTjXy` (`40ea376`).
- Record + sync: #271 (`6e10d12`). Record file: `.claude/releases/promote-2026-10-02b.md`.
- **Migration** `20261002181046_scholarship_applications`. It was applied to prod *before* the merge, with the owner's approval, and recorded in the ledger under the filename. It does two things:
  - creates `scholarship_applications` (25 columns)
  - adds `event_refunds.kind` (`cancellation` default | `scholarship`); all 35 existing rows read `cancellation`
- The prod ledger row for the other session's `20261002164507_event_email_catch_up` was missing. Its schema was live; the 2 Oct (first) record wrongly said it was recorded. **Added** in this session.

## What the feature does
- **Intake (`/api/scholarship`):**
  - Saves the application before anything else.
  - Validates with zod, with length caps.
  - Escapes the staff email and adds a "Review application" link.
  - Sends the applicant an acknowledgement. HubSpot sends none; checked, neither applicant contact had ever been emailed.
- **Review (`/admin/scholarships`, admins only):** pick the event, the member (suggested by email / emergency-contact email / name), and the level (33/50/67/100 → Stripe coupons `SCHOLARSHIP33/50/67/100`). Then:
  - **Offer & register**, or **Not offered** (no email).
  - Resend emails; Retry reimbursement; notes.
- **Offer:**
  1. Links or creates the member.
  2. Attaches an existing registration and discounts `amount_due_cents`.
  3. Sends 3 emails: congratulations; complete details (`/register/<slug>/individual?scholarship=<token>`); payment link (`/scholarship/offer/<token>`). A 100% scholarship sends no payment email and confirms with no Stripe step.
- **Checkout:** `createRegistrationCheckout` pre-applies the coupon (`discounts`), finding it by coupon id or by promotion code, within ±1 point. It fails closed and alerts admins if the coupon can't be resolved.
- **Already registered and paid, then applied:**
  - Refund = event fee actually paid (read from the Stripe checkout line) − scholarship price, capped by Stripe's refundable amount. Paid as card refund (default) or account credit.
  - Audited `event_refunds.kind='scholarship'`. The cancellation path now ignores these rows.
  - Emails: congratulations with the refund line, plus a consent reminder if the DocuSign is unsigned.
  - Group registrations are blocked.
- **Visibility:**
  - Roster: badge, filter, count, and "offers awaiting details".
  - Admin member page and the student's Account page: a Scholarships section.

## Backfill state (prod, end of session)
- **Ethan Lawrence:** application `b8233294…` offered at 50% by David at 21:14Z. Linked to member `7595d329…` and registration `26b91fee…` (pending, **8250** due, was 16500). The 3 emails went to `inbalwal@gmail.com` and `ethanlawrence2011@gmail.com` (activity log). No prod errors or warnings in the following 30 minutes.
- **Shreyas Shankar:** application `57209595…` is `submitted`. **No Colorado registration in prod** as of ~21:20Z; the event is 3 Oct. Runbook: once he has registered, offer 100% with "Email … now" **unticked**.
- **Gmail drafts** for both families are in their threads (`r3592371518100805468` Ethan, `r5838390070885391865` Shreyas). Not confirmed sent.

## Not verified
- **A real discounted checkout through the app.** Dev can't read the events' live Stripe prices, so no event checkout can be built in dev. Ethan's payment is the first. Covered by the Stripe test-mode contract (coupon $165 → $82.50) and unit tests.
- **A real scholarship refund through the app.** Same reason. In dev the quote correctly fell to "manual". Covered by unit tests and the test-mode contract (fee line read after the discount; an idempotent retry produces one refund).
- **The live coupons:** only `SCHOLARSHIP50` was implicitly confirmed (the review page flags the selected level, and none was flagged). 33/67/100 are unchecked.
- **Email delivery:** the activity log records the send. Delivery to the recipients' inboxes is unconfirmed.
- **No e2e spec for the scholarship flow:** unit tests plus manual dev runs only.

## Gotchas found
- **The e2e spec `registration-docusign.spec.ts:74`** asserts the *global* `/admin/docusigns` counters, so any dev fixture that adds a completed or delivered envelope breaks it.
  - On #270 the other session's e-sign drill (`scripts/esign-dev-issue.ts`, `feat/esign-seam`) left one completed.
  - With the owner's OK the row `845115c7…` was deleted from **dev**, and e2e was re-run.
- Auto-fix monitor switches are **per PR**. A new promotion PR needs Auto-fix turned on again.
- The repo now allows auto-merge and deletes branches on merge (owner, 2 Oct). `dev` and `main` are protected, so they are safe from the delete.
- **Coupons discount merch add-ons too.** In test mode, a $15 shirt became $7.50 at 50%, unless the coupon is restricted to the fee product. The retrospective refund is fee-only.

## Dev / test leftovers (deliberate)
- **Dev DB:** test applicants `scholarship-e2e-1002/1003/1004@example.com`, with members, registrations, participants, and DocuSign demo envelopes (`sent`) on the Nevada roster.
- **Stripe test mode:**
  - coupons `SCHOLARSHIP33/50/67/100`
  - two test PaymentIntents, one partially refunded by the contract check
  - test price "Nevada SDC fee (test)"
- **Dev Clerk:** users for 1002/1003, created by the registration route.
