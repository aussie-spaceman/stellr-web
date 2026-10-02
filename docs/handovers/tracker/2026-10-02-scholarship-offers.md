# Scholarship offers — 2026-10-02

Slug: `scholarship-offers`. Handover: `HANDOVER-scholarship-offers-2026-10-02.md`. Doc snapshot: `18YRaPjq_DRaImaSpg6Gu4_DAdIv8fA9oGptAuuAK7tc`.
PR #267 → `dev` as `641d5bb`; promoted in #270 (`139b94c`). Migration: `20261002181046_scholarship_applications` (prod, applied before merge).

Scholarship applications are stored and reviewed at `/admin/scholarships`. "Offer & register" sends three emails, pre-applies the Stripe coupon at checkout, and reimburses students who had already paid. All of this is live in prod.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| scholarship-offers.1 | Shreyas Shankar backfill (100%, record only) | Application `57209595…` submitted in prod; **no Colorado registration** as of 2 Oct ~21:20Z (event 3 Oct) | After he registers: offer 100% with "Email … now" unticked; check the page says nothing to reimburse | ☐ |
| scholarship-offers.2 | Ethan Lawrence backfill (50%) | Offered 21:14Z; registration `26b91fee…` pending, 8250 due; 3 emails logged to both addresses | Watch for his payment: the Stripe charge should be $82.50 with coupon `SCHOLARSHIP50`, and the registration should flip to `confirmed` | ☐ |
| scholarship-offers.3 | Gmail drafts to both families | Drafts in each thread (`r3592371518100805468`, `r5838390070885391865`); send unconfirmed | David sends Ethan's now and Shreyas's after .1 | ☐ |
| scholarship-offers.4 | Live coupons 33/67/100 resolve | Only 50% implicitly confirmed (no flag on the review page) | Open any "To review" application in prod and select 33/67/100. Any red "Stripe problem" note means fix the coupon in live Stripe | ☐ |
| scholarship-offers.5 | Public `SCHOLARSHIP*` promotion codes still active | Anyone with a code gets the discount on any event checkout | Deactivate the promotion codes in Stripe; keep the coupons (the app applies coupons directly) | ☐ |
| scholarship-offers.6 | Coupons discount merch add-ons | Seen in test mode ($15 → $7.50 at 50%); retrospective refund is fee-only | Owner decision: restrict each coupon to the event-fee products in Stripe, or accept | ☐ |
| scholarship-offers.7 | First real scholarship refund (paid-then-applied) unproven in prod | Unit + Stripe test-mode contract only; dev quote is "manual" (live prices unreadable) | On the first such offer, check the Stripe refund (metadata `kind=scholarship`) and `event_refunds` | ☐ |
| scholarship-offers.8 | No "withdraw offer" action | `status='withdrawn'` exists, no UI | Build if needed: reset `amount_due_cents`, set status, optional email | ☐ |
| scholarship-offers.9 | No e2e spec for the scholarship flow | Unit tests + manual dev runs | Add a core spec (form → admin offer → token form), scoped to its own fixtures | ☐ |
| scholarship-offers.10 | e2e `registration-docusign.spec.ts:74` counts dev-wide envelopes | Broke #270 via the e-sign drill's completed envelope; row deleted from dev with OK | Scope the counters to the fixture, or make `esign-dev-issue.ts` clean up after itself | ☐ |
| scholarship-offers.11 | Prod migration + ledger | `db:status --prod` pending = only the 2 known 10 Sept entries, after applying `20261002181046` and adding the missing `20261002164507` row | — | ☑ |

## Closes

- 2 Oct (first) promotion record's claim that `20261002164507_event_email_catch_up` was in the prod ledger: it was not. The row was added, and `db:status --prod` re-read clean.
