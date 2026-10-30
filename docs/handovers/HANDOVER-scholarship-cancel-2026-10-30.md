# Handover — scholarship cancellation (30 Oct 2026)

Tracker: `docs/handovers/tracker/2026-10-30-scholarship-cancel.md` (rows `scholarship-cancel.1–.8`). The one student this concerns is cited by `members.id`; their name is in the Doc snapshot only.

**Not promoted.** The code is on `dev`. Promotion is running in a separate session. As of this close-out, production has neither the migration nor the code.

## Why

David asked for two things:

1. **A way to withdraw or cancel a scholarship.** Admins must be able to do it by hand at any time.
2. **Automatic cancellation on withdrawal.** When a student offered a scholarship withdraws from the event, the scholarship must be cancelled automatically.

The case behind the second ask:
- Student `7595d329-0780-4331-8294-84d7ab1748aa` was offered 50% for Nevada on 2 Oct (application `b8233294-a67f-4cf2-8cc7-8e4b3dabfbc1`).
- Their registration was withdrawn on 20 Oct.
- On 30 Oct the offer was still `offered` on production. The review page read it as "Offered · awaiting details". The offer link still worked, and the checkout would still have applied the 50% coupon if they registered again.

Cause: `scholarship_applications.status` stores only the reviewer's decision, and nothing ever wrote to it after the offer. `withdrawn` was in the CHECK constraint, but nothing set it (tracked as `scholarship-offers.8`).

## Owner decisions (30 Oct, David)

Four questions; the recommended option was chosen for every one except the email:

- **Unpaid registration, admin cancels:** keep the registration. The full fee becomes due and the next checkout charges it.
- **Confirmed registration** (paid, free at 100%, or reimbursed): record only. Nothing is charged, refunded or clawed back. To take the student off the event, withdraw the registration instead.
- **Email:** never. No email to the student on any cancel, like "Not offered". The confirm step tells the admin to tell the student themselves.
- **The stuck production offer:** backfill it in the migration.

## What shipped

**#490 → `dev` `13119444`.**
- Migration: `20261030201934_scholarship_cancellation`.
- Applied to dev on 30 Oct through the Supabase MCP. The ledger row was realigned to the filename, and `db:status` showed it as not pending.
- **Production: not applied.**

### Data

- New decision status `cancelled`.
- New columns: `cancelled_at`, `cancellation_source` (`admin` | `withdrawal`), `cancellation_reason`, `cancelled_by` (Clerk user id), `cancelled_by_name`.
- `cancelled` is not a stage: `scholarshipStage` passes it straight through, so a student who kept a confirmed place is not shown as holding a scholarship.
- `reviewed_*` (who made the offer) and `offer_token` are kept for history.
- A CHECK requires `cancelled_at` and `cancellation_source` whenever `status = 'cancelled'`.
- Backfill: every `offered` application whose registration is already `withdrawn` becomes `cancelled`, with source `withdrawal`, reason "Withdrew from the event", and `cancelled_at` set to the registration's `withdrawn_at`. On production that is only the application above. A second run finds nothing.
- `withdrawn` stays in the CHECK. It is still unused; it could mean the applicant withdrew an application before any decision.

### Behaviour

- **Admin cancel.** "Cancel scholarship…" on `/admin/scholarships/[id]` calls `POST /api/admin/scholarships/[id]/cancel` (`requireScholarshipAdmin`).
  - The confirm step states the effect for the student's stage and takes an optional reason, staff only.
  - Afterwards the page shows who cancelled, when and why, and where the registration now stands, including the amount due.
- **Logic** is in `lib/scholarship-cancel.ts`, function `cancelScholarship`.
  - The update is guarded on `status = 'offered'`, so a race returns 409.
  - An admin cancel on a `pending` registration sets `amount_due_cents` back to the event's Stripe price (`unit_amount`), the same figure the individual form records.
  - If the price can't be read, it leaves the figure and says so. The checkout charges full price either way, because `findOfferForRegistration` no longer finds an offer.
  - Every cancel writes a `scholarship_cancelled` activity row on the member.
- **Auto-cancel.** Every withdrawal goes through `executeDeletion` in `lib/deletion/execute.ts`: member self-withdraw, the admin roster's withdraw and delete, deletion requests, and removing the last student on an individual registration.
  - It reads the live offers before anything changes (`liveScholarshipOffers`), because a hard delete nulls `registration_id`.
  - It cancels them only after the withdrawal succeeds (`cancelScholarshipsOnWithdrawal`), and never throws.
  - The result carries `scholarshipsCancelled`. The staff "withdrew" alert and the admin delete dialog both mention it.
- **Unchanged and why:** the roster, the checkout, the pay route and the offer page all read only `status = 'offered'`, so a cancelled offer drops out of them by itself. The `Cancelled` pill appears in the admin list under "All" and in the member's scholarship history.

### Checked

- **CI on #490**, every step read: `verify` (PII lint, typecheck, design-system lint, unit tests, lint, build), e2e 171 passed with none failed, Storybook 44 of 44.
- **Unit tests:** `lib/scholarship-cancel.test.ts` and the withdrawal cases in `lib/deletion/execute.test.ts`. The shared refund test helper (`lib/refunds/fake-db.test-helper.ts`) gained `update` support.
- **On dev, through the real routes,** on a local server signed in as the e2e admin, using throwaway rows created for the test and deleted afterwards:
  - an admin cancel from the review page, which read back `cancelled / admin`, with the reason and admin name;
  - a soft withdrawal through `DELETE /api/admin/deletion`, which returned `scholarshipsCancelled` and read back `cancelled / withdrawal`.

### Not checked

- The member's own withdraw route with a real scholarship. It uses the same `executeDeletion` path.
- Restoring the fee against a live Stripe price. Dev can't read live prices, so locally the fee lookup took the message path.
- That `dev` deployed `13119444` on Vercel.

## Gaps and process notes

- **Ship Phase 1 and Phase 4 stops not taken.** The checklist and the Partial on the fee restore were reported, but the flow did not stop at them: "ship it" was taken as the go-ahead.
- **Migration file named by hand.** It was created with a `date -u` timestamp rather than `npm run migration:new`. It is the same format and `lint:migrations` passed.
- **The withdrawal hook fails open on a read error.** If `liveScholarshipOffers` cannot read, it logs and returns nothing, so the withdrawal goes ahead with the offer still live and no staff alert (`.5`). This is deliberate (never block a withdrawal), but unlike the deletion code's fail-closed reads.
- **Another session's ledger row.** On 30 Oct, dev's ledger also had `20261030202604 artwork_defaults` from another session's work (#491). It was not touched here.

## Open items

See the tracker. Most important: `.1`, production gets the migration before the code; and `.2`, confirm the stuck offer reads `cancelled` afterwards.
