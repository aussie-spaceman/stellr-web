# Group registration price refusal — 2026-11-06

Slug: `group-price-refusal`. Handover: `HANDOVER-group-price-refusal-2026-11-06.md`. Doc snapshot: `1VuhDIVILicatcR1w8ZxMZl4UHF_l7lTgsb0FyceLuGQ`.
PR #570 → `dev` as `bd890c34`; not promoted. Migration: none.

`POST /api/register/group` on a priced event answers a retryable 503, before anything is written, when Stripe can't return the price. Free events and campaigns are not refused.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| group-price-refusal.1 | Fix reaches production | On `dev`, deployment for `bd890c34` READY on the dev project. Not on `main`. | Include in the next promote. Owner's decision. | ☐ |
| group-price-refusal.2 | Refusal seen with a real Stripe failure | Proven only with a mocked failure in `route.branches.test.ts`. | One group registration on a priced dev event should answer 503 and write nothing. | ☐ |
| group-price-refusal.3 | Check before promoting | Not done. The check is in the Doc. | Run the read-only query named in the Doc, row `.3`. | ☐ |
| group-price-refusal.4 | Witnessing group payment paths on dev | Group registrations on priced dev events now answer 503, because dev has a test Stripe key and live price IDs. | Put a test-mode price on the dev event before witnessing. | ☐ |
| group-price-refusal.5 | Refusal wording for a deleted price | Says to try again shortly, which won't help if the price is gone. The cause shows only in the log. The individual route says the fee is misconfigured. | Owner's call: leave it, or tell the two cases apart by Stripe's error code. | ☐ |
