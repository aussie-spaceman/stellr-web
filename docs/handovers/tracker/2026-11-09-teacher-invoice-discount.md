# Teacher invoice discount codes, and the 9 Nov promotion — 2026-11-09

Slug: `teacher-invoice-discount`. Handover: `HANDOVER-teacher-invoice-discount-2026-11-09.md`. Doc snapshot: `1jYDk8-VFhuaR1NgSQbSCUwBfK4e3eKaccgUf8xEGGK4`.
PR #597 → `dev` as `521e4cd9`; promoted in #600 (`89559a4f`), record #603 (`7e90b757`). Migration: none for #597; the promotion applied `20261109224229_email_outbox` and `20261109230000_event_email_templates` to production first.

A teacher or Teacher POC can add, replace or remove a promotion code on their group's invoice, on the registration form or later from Account → Teams, and assigned event managers can change invoice discounts on their own events. Only promotion codes resolve for anyone but an admin.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| teacher-invoice-discount.1 | The teacher whose invoice prompted this still has no code on it | Production can now fix it (teacher from Account → Teams, or an admin from roster → "Invoice & discount…"). Which code the teacher expected is not known in the repo; names and the email thread are in the Doc. Nobody has replied to the thread from this session. | Reply to the teacher: point them at Account → Teams, or apply the code for them from the roster once they name it. | ☐ |
| teacher-invoice-discount.2 | First real code applied by an organiser in production | Never exercised against real Stripe: dev cannot price live events, so preview, apply, remove and the emailed revised invoice ran only against fakes (route and component tests). | After the first use, read `activity_log` for `group_invoice_discount_applied` and the audit row `registration.invoice_discount.change`, and check the revised invoice total in Stripe. | ☐ |
| teacher-invoice-discount.3 | Account → Teams panel never seen in a browser | The owner's dev account has no teams, so the panel was checked only by component tests (`components/member/GroupDiscountCode.test.tsx`). | Open Account → Teams as an organiser of an invoiced group (dev seed or view-as on production, which is read-only) and check the panel renders and reads well on mobile. | ☐ |
| teacher-invoice-discount.4 | Registration form code field: first real use | Route tests save `invoice_coupon_id` / `invoice_promotion_code` for "invoice" and "invoice for some"; a bad code is a 400 and nothing is written. No real registration has carried a code yet. | After the first group registration with a code, check the registration row and that its first invoice carries the discount. | ☐ |
| teacher-invoice-discount.5 | Event manager changes an invoice discount | Opened to assigned managers of that event (`test/events-admin-records-c16.test.ts`); refused for another event with 404. Not used in production yet. | Nothing to do until it is used; check the audit row's actor label reads `event_manager`. | ☐ |
| teacher-invoice-discount.6 | Promotion-code redemption limits on invoices | A code's `max_redemptions` and expiry are checked when it is typed, but an invoice applies the underlying coupon, so Stripe does not count the redemption. This was already true for staff-applied codes. | Owner decision: accept, or count invoice uses ourselves before a capped code is handed to teachers. | ☐ |
| teacher-invoice-discount.7 | `npm run verify:prod` after the promotion | Not run: the local credentials are dev's, so its Stripe and DocuSign lines would describe dev. The live checks that did run are in `.claude/releases/promote-2026-11-09b.md`. | Run it with production credentials if a Stripe or DocuSign problem is suspected; otherwise leave. | ☐ |

## Closes

- `resend-quota-outbox.1`: migration `20261109224229_email_outbox` applied to production with the owner's yes before the merge; ledger renamed to the filename and `db:status --prod` re-read (pending only the old `20260910140426/27`). Promoted in #600 (`89559a4f`), production deployment `dpl_7ooYV9jMMBHz93AWHLub4DihuLGa` READY; `/api/cron/email-outbox` answers 401 without the cron secret.
- `email-templates-fields.1`: `20261109230000_event_email_templates` applied to production the same way; `event_email_templates` has RLS on, no anon/authenticated grants, three policies.
- `email-templates-fields.2`: #596 promoted in #600 (`89559a4f`).
- `awards-no-show.1`: #590 promoted in #600 (`89559a4f`).
