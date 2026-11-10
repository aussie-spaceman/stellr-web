# Handover: teacher invoice discount codes, and the 9 Nov promotion — 2026-11-09

Tracker: `tracker/2026-11-09-teacher-invoice-discount.md`. PR #597 → `dev` as `521e4cd9`. **Promoted** in #600 (merge `89559a4f`, deployment `dpl_7ooYV9jMMBHz93AWHLub4DihuLGa`); record `.claude/releases/promote-2026-11-09b.md` (#603). Migration: none for #597.

## Context

Twice, a teacher registered a group to pay by invoice and was sent an invoice without the discount code they expected. A Stripe Checkout has its own code box; an invoice has none, and the registration form had no code field either. The interim fix let staff add a code from the roster, but it was in fact admins-only: event managers got 403. Only staff could ever correct an invoice.

The owner's answers to the clarifying questions:
- **Where:** both a field on the group registration form (the first invoice carries it) and a panel in Account → Teams, any time before the invoice is paid.
- **Staff codes:** the teacher can replace or remove any discount, a staff-applied one included.
- **Event managers:** yes, for their own events.

## What changed

- `lib/group-billing.ts`: `resolveDiscountCode(stripe, code, { promotionCodesOnly, productId })`. With `promotionCodesOnly` a bare coupon id never resolves, and an inactive, customer-bound, expired or used-up promotion code is refused (`promotionCodeUsable`). With `productId`, a coupon limited to other products is refused. New `previewGroupDiscount` for the "check code" step.
- `app/api/members/teams/[id]/discount/route.ts` (new): GET shows the code and invoice total; POST previews, applies or removes. Teacher and Teacher POC can change it; a student manager sees it read-only; view-as is refused; a paid invoice or a group not paying by invoice is refused before Stripe is asked. Changes go through `setGroupDiscount`, which revises the open invoice and emails it. Audited as `registration.invoice_discount.change`.
- `components/member/GroupDiscountCode.tsx` (new), in `TeamsTab`: check a code, see the new total, then "Apply and send revised invoice"; "Remove code".
- Registration: `GroupRegistrationForm` shows "Discount code (optional)" for invoice / invoice for some; `lib/registration/group/price.ts` resolves it (promotion codes only, this event's product) and `persist.ts` saves `invoice_coupon_id` / `invoice_promotion_code`, which `createAndSendGroupInvoice` already applied. A bad code is a 400 with nothing written; a lookup failure is a 503.
- `app/api/admin/registrations/[id]/invoice/route.ts`: open to the assigned event manager of that event (other events still 404); non-admins resolve promotion codes only; the actor label is `admin` or `event_manager`.
- `lib/teacher-share.ts`: the shared-cost seat pay page resolves promotion codes only, the same rule.

## Promotion (#600)

Everything on `dev` at `ca3c015c`: #597, #596, #594, #592, #590, #588, #598, #601 and four close-out docs PRs. Two migrations applied to production first with the owner's yes and recorded under their filenames. Production checks after the deploy: `www` 200, `app` 307 to sign-in, cron guard `Unauthorized`, the new outbox cron and discount route 401, no runtime errors in 15 minutes. Full detail and rollback target in the release record.

## Not verified

- Nothing ran against real Stripe (`.2`, `.4`).
- The Account → Teams panel was never seen in a browser (`.3`).
- `verify:prod` not run against production credentials (`.7`).
- On the promotion's final head, `e2e-local` (report-only) was still running at merge; it passed on the previous head, and only docs changed after it.

## Open items

See the tracker file: `.1` the original teacher still needs their code and a reply (names in the Doc), `.2` first real code, `.3` panel in a browser, `.4` first registration with a code, `.5` first event-manager change, `.6` owner decision on redemption limits, `.7` `verify:prod`.

This session closed `resend-quota-outbox.1`, `email-templates-fields.1`, `email-templates-fields.2` and `awards-no-show.1` (evidence under "Closes" in the tracker file).
