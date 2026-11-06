# Handover: group registration price refusal, 6 Nov 2026

**Not promoted.** PR #570 is on `dev` as `bd890c34`, and its deployment on the dev project is READY. Production is unchanged. Promotion is a separate owner decision.

Open items are in `tracker/2026-11-06-group-price-refusal.md`. Further detail is in the private Doc named in that file's header.

## What changed

- **`lib/registration/group/price.ts`:** when `prices.retrieve` fails for an event with a Stripe price, the gate returns `temporarilyUnavailable()` (503). This applies to invoice, card, members paying individually and `none`. The lookup comes after every validation and before every write, so nothing is written.
- **Exempt:** free events have no price to read. A campaign collects nothing and the field is hidden for it in Sanity, so a price left on its document doesn't refuse it.
- **`lib/registration/group/respond.ts`:** the invoice step no longer re-derives the amount, because the gate always knows it by then.
- **Tests:** in `app/api/register/group/route.branches.test.ts`, three tests were replaced and new ones added. The characterisation tests and `route.test.ts` are unchanged and pass.

## Choices worth knowing

The individual route also answers 503, but with its own "fee is misconfigured" message. The group route uses `temporarilyUnavailable` because its gate already does for other failed reads. The two messages differ on purpose for now (row `.5`).

## Consequence on dev

Dev has a test Stripe key and its events carry live price IDs, so a group registration on a priced dev event answers 503, as an individual one already does. Witnessing the group payment paths on dev needs a test-mode price on the event (row `.4`).

## Left as it was

- A priced event with Stripe not configured still writes for `none` and members paying individually. Card and invoice are refused with a 400.
- If the invoice step's own price read fails, no invoice is sent and the registration completes with the correct amount, so the admin setup tool can send the invoice.
- A price with no unit amount (tiered, for example) reads as free, as an existing test pins.

## Not verified

- The refusal has only been seen with a mocked Stripe failure (row `.2`).
- The check before promoting has not been run (row `.3`).
