# Handover — group billing follows the roster (29 Oct 2026)

Tracker: `docs/handovers/tracker/2026-10-29-group-billing-roster.md` (rows `group-billing-roster.1–.8`). People are named only in the Doc snapshot, against the row IDs.

## Why

The organiser of the Minnesota Environmental Design Challenge group (registration `0e416e3b-8a3d-4348-b1fb-88e4f3873ff9`, educator `58d6e89c-9955-4f93-8c39-752aa6cd44a1`) asked for one student to come off the $1,843 invoice (19 × $97) and for the 15% flyer code to be applied. The app could do neither: a group invoice never changed after it was sent, admins had no way to add a discount, and a paid group invoice could not be refunded at all, because the `invoice.paid` webhook never stored its payment intent. Refunds also used the event's list price, so a discounted place could be refunded more than it cost (`12.2`).

## Owner decisions (29 Oct, David)

- Automatic refunds follow the 45-day money-back guarantee (Terms §9.1). Outside it, no refund; the payer is told why and staff can override by hand.
- Removing a participant always frees the place: the group gets one fewer place. Replacing someone is a removal plus an addition.
- Members get a self-service **Withdraw** for individual registrations, and the member record must persist so they can be contacted in future years (soft withdraw).

## What shipped

**#477 → `dev` `0b06d87b`; promoted in #475 (`3164a423`, `dpl_5Vjb9hKpCEWYFSRpnufANojJucXJ`); record #479.** Migration `20261029120000_group_invoices.sql`, applied to dev and to production before the merge (David's yes on the exact SQL); both ledgers aligned to the filename.

- **`lib/group-billing.ts`** — a group's declared size (`adult_count + student_count`) is what it is billed for. `applyRosterChange` runs after every roster change:
  - unpaid invoice → Stripe's own revision (`invoices.create({ from_invoice: { action: 'revision' } })`): the line is replaced by one per-place line (quantity × price), the discount is re-applied, finalising voids the original and Stripe emails the organiser. Stripe allows one draft revision; an existing one (e.g. started in the Dashboard) is reused. Last participant removed → invoice voided.
  - paid group (invoice or card) → a removed place is refunded by the caller through `executeRefund`; an added place beyond the declared size gets a separate `kind: 'additional'` invoice (a percentage discount carries over; a fixed amount does not).
  - members-pay-individually and free groups: places are tracked, nothing invoiced.
  - Never throws; a Stripe failure alerts staff (`notifyCommunityAdmins`) and tells the organiser a corrected invoice will follow.
- **`group_invoices` ledger** — every group invoice: places, per-place price, discount, total, the invoice it replaced, a plain-language reason, and (for additional invoices) the participants covered. Pre-ledger invoices are adopted the first time they are touched (per-place = subtotal ÷ declared places). Stripe is re-read before any action.
- **Callers:** teacher remove + student "Leave team" (`app/api/members/teams/[id]/participants/[pid]`), teacher add (`…/participants`), sheet sync (`lib/sheet-participant-sync.ts`, one call per sync), admin roster delete (`lib/deletion/execute.ts`; deleting or withdrawing a whole group voids its open invoices). The first invoice at registration and from "Finish setup…" goes through the same module (`lib/group-invoice.ts`), falling back to the input if the registration can't be read.
- **Refunds** — `lib/refunds/payment-basis.ts` finds which payment covered a place and what it actually cost: a paid group invoice's total ÷ its places, else the Checkout fee line's total ÷ its quantity, else list price; Stripe's remaining-refundable cap still applies. A place paid by a Stripe invoice gets a credit note linking the app's own refund (so `metadata.source=stellr_app` stays on it). Group-paid refunds notify the organiser, not the student. A refund that needs a hand alerts staff when a member or organiser (not an admin) started it.
- **Webhook** — `invoice.paid` for a group invoice calls `recordGroupInvoicePaid`: ledger → paid, payment intent stored on the registration (main invoice) or on the covered participants (additional invoice); an additional invoice does not re-confirm the registration.
- **Admin "Invoice & discount…"** (`components/admin/GroupInvoiceButton.tsx`, `/api/admin/registrations/[id]/invoice`) on invoiced groups in the roster: places, current invoice, history with reasons, and a discount code (promotion code, any case, or coupon id, exact case) with a preview before "Send revised invoice". Writing is admin-only; event managers can read. A paid invoice can't be changed.
- **Billing tab** — each group invoice shows its reason, superseded ones read "Replaced by …", draft revisions are hidden, and a Refunds list shows the payer's refunds.
- **Teams tab** — the remove confirmation says what will happen; afterwards the organiser sees what happened to the invoice or refund. Adding a participant shows the same.
- **Withdraw** (`components/member/WithdrawRegistrationButton.tsx`, `/api/members/registrations/[id]/withdraw`) on individual registrations not yet checked in: the dialog states the refund outcome first; withdrawing is `executeDeletion('registration', soft)` with the guarantee refund — registration `withdrawn`, participant and member rows kept, unsigned agreements voided, event Space access removed, staff notified. Hidden in admin view-as.

## First production use (29 Oct, after the deploy)

David removed the student from the roster and applied STEMCAREERS through the new dialog. Read back from the ledger and from Stripe:

- `2EFXPOSM-0001` (19 × $97 = $1,843) adopted into the ledger, then void with `latest_revision` set.
- `2EFXPOSM-0002` (18 × $97 = $1,746): the Dashboard draft revision started earlier that day, reused as designed; sent, then voided 44 s later by the discount revision.
- `2EFXPOSM-0003` (18 × $97 − STEMCAREERS $261.90 = **$1,484.10**): open, memo says which invoice it replaces. Registration now 1 adult + 17 students, coupon stored.
- The organiser therefore received **two** Stripe invoice emails about a minute apart; the second is the one to pay.

## How it was verified

- Unit tests: 23 new (`lib/group-billing.test.ts` and a paid-group-invoice refund test); full suite 2,523 passed; CI every step read on #477, #475 (twice — dev moved by a docs-only close-out between approval and merge) and #479.
- Stripe test mode + dev DB drill (script deleted afterwards): invoice → removal → revision → coupon → paid with a test card → payment intent recorded → refund of $82.45 (not the $97 list price) with a credit note → two additions → additional invoice $164.90 → group withdrawal voids it.
- Browser, signed in on dev: admin dialog preview and send, teacher Billing tab with "Replaced by", member Withdraw (registration withdrawn; participant and member kept). That run caught one bug, fixed before shipping: the discount box upper-cased input, but coupon ids are case-sensitive.
- Production: site 200, app 307 → sign-in, cron guard `Unauthorized`, both new routes 401 signed out, no runtime errors since the deploy, and the first real use above.

## Not verified

- `invoice.paid` → `recordGroupInvoicePaid` against a real Stripe event (dev has no test webhooks; the drill called it directly). First chance: the MN invoice being paid (`.1`).
- Live refunds: a card-paid group place (Checkout fee-line basis), a paid individual withdrawal, a credit note on a real paid invoice. Whether Stripe emails credit notes and refund receipts to customers depends on Dashboard settings, not checked (`.5`).
- Sheet-sync additions and additional-places invoices in production (`.6`).
- In production: the Billing tab history, the Teams-tab removal message, Withdraw, and the admin delete dialog's billing notice (all checked on dev, `.4`).

## Known behaviour and limits (`.7`)

- Each revision emails the organiser, so a removal followed by a discount sends two invoices a minute apart.
- A discount can't be applied to an invoice that is already paid (refund the difference by hand).
- A fixed-amount coupon (e.g. $28 off) comes off a group invoice once, not per participant.
- While an additional-places invoice is unpaid, the added participants still read as paid on the roster (`registrationPaid` uses the main invoice).
- A teacher removing an unpaid participant writes an `event_refunds` row "Unpaid — nothing to refund", as admin deletions already did.

## Session notes

- The decision question offered "admin roster delete preselects the refund" as part of the recommended option; David chose to add the Withdraw button "as well". The admin delete dialog still asks the admin to choose, with nothing preselected (`.3`).
- `group-registration-followups.3` (license alerts live) was promoted by this session in #475 (`3164a423`, deployed); the production UI check in that row's Next was not done, so the row stays with its owner. `group-registration-followups.5` (MN invoice paid) now refers to the $1,484.10 invoice `2EFXPOSM-0003`, not the $1,843 one.
- Temporary dev data (seeded groups, Stripe test customers and coupons, a fixture teacher's `stripe_customer_id`) was removed and read back; dev has no rows left from this session.
