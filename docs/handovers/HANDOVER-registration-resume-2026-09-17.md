# Handover — Resumable registration payment, 17 Sept 2026

**For:** whoever next touches event registration, Stripe checkout, or the
"complete your payment" emails.
**Prompted by:** Gloria Ahaiwe's email of 14 Sept. She started registering her
son Daniel for the Colorado Space Design Challenge (3 Oct), closed the tab
before finishing Stripe Checkout, and could not get back in: resubmitting the
form returned *"This email address is already registered for this event."*
User story: *as a parent (or teacher, for a group) I may get interrupted and
need to come back to the registration process.*

## 1. What was wrong

A registration is fully created — `registrations`, `participants`, `members`,
Clerk user, DocuSign envelope — **before** payment, but the only route to
payment was the one-time browser redirect at the end of the form.

1. Nothing was emailed at submission (the individual confirmation email is
   sent by the Stripe webhook, after payment). Daniel's registration
   (`98f623e4…`, `pending`, $75) had produced no email at all.
2. Stripe's `cancel_url` returned to the blank form; nothing read `?cancelled`.
3. The duplicate check refused any participant on the event regardless of
   `status`, so the unpaid `pending` row blocked the retry. It also queried
   `participants` by email with `.maybeSingle()` and no event filter — an
   address on two events errored and skipped the check silently.
4. The only self-serve "Pay now" was Account → Billing, under the *student's*
   login; it omitted merch add-ons and tested a status (`cancelled`) that does
   not exist.
5. Admin had no way to send a payment link, and the bulk reminder told people
   to "use the payment link previously emailed" — which never existed for
   individual registrations.
6. Group card path: `groupConfirmationEmail` said the card payment *"has been
   processed — your group registration is confirmed"*, sent before Stripe.

## 2. What changed

**Data.** `registrations.pay_token` (text, unique) and `pay_link_sent_at`
(`supabase/migrations/20260917160000_registration_pay_token.sql`). A column,
not a table: 1:1 with the registration, no expiry — the link is only honoured
while `status = 'pending'` and the event's registration window is open. Minted
at insert for individual and group-card registrations; `ensurePayToken()`
mints lazily for rows that predate the column (Daniel's).

**One checkout builder.** `lib/registration-checkout.ts` —
`createRegistrationCheckout(db, stripe, registrationId, { successUrl,
cancelUrl, event?, customerEmail? })` builds the Stripe session from the
registration row (fee × seats, pending merch add-ons from
`store_orders`/`store_order_items`) with the metadata the webhook already
matches on. Used by both register routes, the pay route and Account → Billing.
The webhook is untouched.

**Pay page.** `/register/[slug]/pay/[token]` (`app/(public)/register/[slug]/pay/[token]/page.tsx`)
shows first name, event, seats, amount and a Pay now button that POSTs
`/api/register/pay { token }` for a fresh session. States: invalid, already
paid, withdrawn, invoice/members-pay-individually, registration closed.
`noindex`. Both register routes' `cancel_url` now land here with
`?cancelled=1`. Token-minted sessions omit `customer_email` so a paying parent
can enter their own address and receive the receipt.

**Email at submission.** `registrationPaymentLinkEmail` (`lib/email.ts`) —
*"Your registration is saved"* with the pay page link — goes to the registrant
and their emergency contact the moment a paid individual registration is
created (`lib/registration-pay-link.ts`, `sendPayLinkEmail`). Group card
registrations get the link inside the existing confirmation email, whose
"processed — confirmed" wording is replaced. Cooldown of 10 minutes on
unauthenticated re-sends via `pay_link_sent_at`; the admin path forces.

**Duplicate → resume.** `lib/registration-duplicates.ts` —
`findExistingRegistrations()` (one lookup, event-filtered, ignores withdrawn,
also matches `registrations.teacher_email` for organisers with no participant
row) and `resolveDuplicate()`:

| Match | Signed in as that email | Not signed in |
|---|---|---|
| pending individual / organiser of pending card group | `200 { resume, checkoutUrl }` → straight to Stripe | re-send pay link, `409 unfinished_registration` (masked addresses) |
| confirmed, or pending on a non-card path | `409 already_registered` | same |
| participant in someone's group | `409 in_group` | same |
| organiser with open invoice | `409 invoice_pending` | same |

The forms render `unfinished_registration` as a blue info panel
(`role=status`), not a red error.

**Admin.** "Send pay link" in the roster (`components/admin/SendPayLinkButton.tsx`,
per individual row / group header when `payLinkSendable`) →
`POST /api/admin/events/[slug]/payment-link { registrationId, extraRecipients? }`,
logged as `billing/payment_link_sent`. The bulk reminder now carries the link
(`outstandingItemsReminderEmail({ payment: { method, payUrl } })`).

## 3. Verification

- `npm test` 76 files / 676 tests green (new: `lib/registration-checkout.test.ts`,
  `lib/registration-duplicates.test.ts`, `lib/registration-pay-link.test.ts`,
  `lib/email-registration-templates.test.ts`, `app/api/register/pay/route.test.ts`,
  `app/api/admin/events/[slug]/payment-link/route.test.ts`).
- `npm run build` green (prebuild lints included).
- Dev DB (`xvxlhbxtiwxpopoqjygm`): migration applied via MCP, ledger row
  realigned to `20260917160000` (see memory: MCP records its own timestamp).
- Seed: the pending fixture registration `…d000-000000000002` now carries
  `pay_token = repeat('0123456789abcdef', 4)`, `$75.00`, and participant
  Mia Unpaid with a parent emergency contact.
- Browser (worktree on :3010): pay page renders for the fixture with the
  cancelled banner and masked address; bogus token → "isn't valid"; Pay now →
  `/api/register/pay` (400 `nothing_to_pay` for the fixture, which has no
  Sanity price — correct); `POST /api/register/individual` with the fixture's
  email → `409 unfinished_registration`, email sent (dev safelist),
  `pay_link_sent_at` stamped, second call within 10 min → "We recently
  emailed"; the real individual form (Colorado slug, fetch stubbed to the 409)
  shows the blue panel.
- `e2e/core/registration-resume.spec.ts` — 3 passed against the worktree
  server (host pinned by `global-setup`).
- **Not** exercised: a live Stripe session (local env holds `sk_live_`), the
  admin roster button in a browser (the seed event has no Sanity document, so
  `/admin/competitions/seed-regional-challenge` 404s) — the route is
  unit-tested and the button is a fetch + label.

## 4. Remediation for Daniel Ahaiwe (after promote)

1. `promote` applies the migration to production **before** the code merges.
2. Admin → Competitions → Colorado Space Design Challenge → roster → Daniel's
   row → **Send pay link**. Recipients resolve to `dan.ahaiwe@gmail.com` +
   `glo.ahaiwe@gmail.com` (the emergency contact on the participant row); the
   prompt accepts extra addresses if needed.
3. Reply to Gloria's thread. The link works until registration closes; the
   Stripe session it opens is fresh each click.

## 5. Left open / deferred

- **Browser draft of the form** (interrupted *before* submitting) — deferred
  by the owner on 17 Sept: DOB, phone and guardian details in `localStorage`
  on shared school machines outweigh same-tab recovery.
- **Free individual registrations stay `pending`** (`individual/route.ts`, the
  `nothing_to_pay` branch) — pre-existing; the group route confirms free
  registrations at insert. `sendPayLinkEmail` refuses these
  (`nothing_to_pay`) so nobody is told "$0.00 is still needed".
- `/community?registered=1&type=individual&payment=success` — the individual
  success URL — is consumed by nothing in `app/(member)`. Unrelated, noted.
- Pre-existing React warnings on the individual form (`SchoolSearchInput`
  setState-in-render; a `<script>` inside a component) — not touched.
