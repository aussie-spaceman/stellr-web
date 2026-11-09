# Change how a group pays — 2026-11-09

Slug: `group-payment-change`. Handover: `HANDOVER-group-payment-change-2026-11-09.md`. Doc snapshot: `1vRc37TPr5T6AhDXNGH_mU5S18fw3SNajjy-TDpVkWg0`.
PR #573 → `dev` as `b21fe4f7`; promoted in #574 (`540e4e9b`, deployment `dpl_4WD3mHf9MP6FJPRbvayNhBeut1oP`). Record + sync #575 (`720ee16b`). Migration: none.

Admins, event managers assigned to the event, and a group's teacher or Teacher POC can move an unpaid group between invoice, card and individual payment (roster "Payment method…", Account → Teams "How this group pays"). Pay links now work whatever the event's registration status.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| group-payment-change.1 | Reaches production | #574 merged 9 Nov 15:38Z; `Vercel – stellr-web` success on `540e4e9b`; www 200, app 307, cron guard 401, both `payment-method` routes 401 anonymously. | None. | ☑ |
| group-payment-change.2 | Reply to the teacher who asked to move their invoiced group to individual payment | Not replied. Names in the Doc, row `.2`. | Tell them they can switch it under Account → Teams, or staff do it from the roster. | ☐ |
| group-payment-change.3 | First real change watched end to end | Not happened. Only a test-mode drill on the dev database (real Stripe test calls, price stubbed) and unit tests. | After the first change: the old invoice shows void in Stripe, pay-link emails and the organizer email went out, and staff got the alert if the organizer made it. | ☐ |
| group-payment-change.4 | Confirm clicked in a browser | Never. Dev events can't return a price with the test key, so the dialog was checked with sample data only. | Covered by `.3` if the first change is made in the UI. | ☐ |
| group-payment-change.5 | Audit row with a resolved actor | `withAudit` with `{ session: true }` is unit-tested; no real row seen. | After `.3`, read `audit_log` for action `registration.payment_method.change` and confirm the actor is filled. | ☐ |
| group-payment-change.6 | Late-payment staff alert | Unit tests only (`notePaymentAfterMethodChange` from the Stripe webhook). | Watch for it if a payment lands on an old link after a change; no forced test. | ☐ |
| group-payment-change.7 | Paid main invoice + unpaid additional-places invoice | Refused, and the message says there's no balance to move although the additional invoice is open. | Owner's call: allow moving just the additional balance, or reword the refusal. | ☐ |

## Closes

- `group-price-refusal.1`: #570 promoted in #574 (`540e4e9b`); production deployment `dpl_4WD3mHf9MP6FJPRbvayNhBeut1oP` completed 9 Nov. `group-price-refusal.3` (the production check for rows already at $0) was **not** run and stays open.
