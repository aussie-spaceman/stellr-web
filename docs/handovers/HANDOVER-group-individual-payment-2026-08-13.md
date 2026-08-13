# Handover — group registration: individual payment + DocuSign dedupe

**Session:** 13 Aug 2026 · **Shipped — code on `main`, migration applied to prod.**

> ⚠️ This shipped in two halves, by two different sessions, and that briefly broke
> production. Read [Deployment state](#deployment-state) before touching anything
> here — the sequencing lesson matters more than the code.

---

## The problem this fixes

Group registration offers "Group members will pay individually". Five code paths
can create a participant in such a group. Only **two** ever billed anyone:

| Path | Before | After |
|---|---|---|
| `POST /api/register/group` — "add now" | ✅ billed (paid events only) | ✅ |
| `POST /api/register/group-join` — join link | ✅ billed (paid events only) | ✅ |
| Google Sheet sync (manual button) | ❌ DocuSign only | ✅ |
| Google Sheet sync (Drive webhook) | ❌ DocuSign only | ✅ |
| Organiser manual add (Teams tab) | ❌ DocuSign only | ✅ |

Consequences of the three gaps, all now closed:

1. Sheet-added people got no payment link and `individual_payment_status = NULL`.
2. `NULL` made the member's own "Pay now" button 400 with *"No payment required"*
   (`payment-link` routes require `=== 'pending'`).
3. **Money bug:** the Stripe webhook confirmed the whole registration once no row
   was `'pending'`. `NULL` rows were invisible to that check, so the group flipped
   to `confirmed` while those people still owed.

Plus two bugs found in passing — see [Related fixes](#related-fixes-found-in-passing).

---

## Architecture

Everything routes through one helper. **If you add a sixth way to create a group
participant, call this or the bug comes straight back.**

```
lib/individual-payment.ts
  └── ensureIndividualPayments(db, registrationId, people[])
        ├─ no-op unless registrations.member_pays_individually
        ├─ skips anyone with participants.individual_payment_link_sent_at set
        ├─ event HAS a Stripe price → checkout session + payment email → 'pending'
        └─ event has NO price (free) → "no payment required" email → 'waived'
                                        + one notifyCommunityAdmins alert per batch
```

Callers:

| File | Call site |
|---|---|
| `app/api/register/group/route.ts` | third payment branch, after invoice / card |
| `app/api/register/group-join/route.ts` | after `dispatchAgreement` |
| `lib/sheet-participant-sync.ts` | end of sync, passed **every** sheet row |
| `app/api/members/teams/[id]/participants/route.ts` | after `dispatchAgreement` |

### Idempotency contract

`individual_payment_link_sent_at` is stamped **only after a successful send**.
`individual_payment_status` is stamped **before**, and also at INSERT time in
`group/route.ts`. That split is deliberate:

- Status early → the row is visible to the webhook's "has the whole group paid?"
  check, and correctly `waived` on a free event, **even if the email fails**.
- `sent_at` late → a failed send is retried on the next sync instead of being
  silently swallowed. The old inline code stamped status first and never retried.

The sheet sync passes *all* rows, not just newly created ones, so anyone entered
before this existed is picked up on the next sync.

---

## DocuSign dedupe

All three checks now live inside `dispatchAgreement` (`lib/docusign-agreements.ts`),
so no caller can skip them. The participant-level check used to be a private copy
inside the sheet sync and was **absent everywhere else**.

Order, cheapest first:

1. **This participant already has an envelope** → return.
2. **An open envelope for this person on this event** → return.
   Statuses `created` / `sent` / `delivered`.
   ⚠️ There is **no `'partial'` status** — see the CHECK in migration 010. Comments
   elsewhere in the codebase imply there is; they are wrong.
   Matched on `member_id` when present, else `signer_email`.
3. **Unexpired signed paperwork on the member record** (3-year validity) → record a
   coverage row + send the "already on file" email.
   New: falls back to `members.email` when the caller has no `memberId`. A failed
   or skipped member upsert previously bypassed this check entirely and re-sent
   paperwork the person had already signed.

On a query error the open-envelope check returns `false` and issues anyway —
a possible duplicate is a safer failure than leaving a minor unpapered.

---

## Free events

`stripePriceId` blank in Sanity = free. It is **indistinguishable** from "someone
forgot to paste the Price ID", which drove the design:

- **Waive, don't reject.** Rejecting the free+individual combination makes the
  "registered, no payment required" email unreachable, which is the requirement.
- **Alert once per batch that actually waived** (`notifyCommunityAdmins`), so a
  genuinely free event is quiet and a misconfigured paid one surfaces immediately.
- **The form no longer asks "how will the group pay?" on a free event.** It shows a
  green panel and sends `payment_method: 'none'` + **`member_pays_individually: true`**.

That last flag is counter-intuitive and load-bearing: on a free event each member
individually owes nothing, and setting it `true` is precisely what routes every
participant through the helper and gets them the confirmation email. Setting it
`false` suppresses the requirement entirely. Campaigns keep `false` — they have
their own confirmation email.

---

## Related fixes found in passing

**Free event + invoice was silently broken.** The `$0` guard only fires when a price
positively resolved to zero (`feeUnitAmount !== null`). An event with *no* price left
it `null` and slipped past: the registration was created with `invoice_requested=true`,
the invoice block skipped on `stripePriceId &&`, and every member surface reported
*"Invoice sent to organiser"* for an invoice that never existed. Same class as the
8 Jul fix, reached by a different door. Now rejected up front, mirroring the card guard.

**`registrationPaid` learned `'waived'`** (`lib/payment-status.ts`) so the access gate
and roster pills don't read a free participant as unpaid forever.

---

## Deployment state

| Item | State |
|---|---|
| Code | **Shipped.** Committed by a parallel session as `fdad774 "group fix"` (19 files, +954/−151), merged to `origin/main`, auto-deployed |
| Migration `137_individual_payment_waived.sql` | **Applied to prod** as version `20260813213834`, name `individual_payment_waived` |
| `tsc --noEmit` | clean |
| `npx vitest run` | 197 passed / 33 files |
| `npm run lint:tokens` | clean |

Migration 137 does two things and has **no backfill** (existing rows are demo data):
extends the `individual_payment_status` CHECK to allow `'waived'`, and adds
`individual_payment_link_sent_at timestamptz`.

### ⚠️ How this broke prod, and the rule that follows

The code and the migration shipped **separately, by different sessions**, code first.
For the window between them, prod ran code that writes `'waived'` and reads
`individual_payment_link_sent_at` against a schema that had neither. Result:

- **Group registration on any free event returned 500.** `seatPayStatus` resolves to
  `'waived'` at INSERT, the old CHECK rejected it, the participant insert failed, and
  the route's rollback deleted the registration.
- **Individually-paid groups on paid events silently sent nothing.** The helper's
  first query selects `individual_payment_link_sent_at`; the column didn't exist, the
  error was caught non-fatally, and it returned early every time.

Both cleared the moment the migration applied. The rule: **this migration is not
optional and not "additive, so it can follow" — the code hard-depends on both halves
of it.** Any future change that writes a new enum value or reads a new column has the
same shape. Apply the migration first; it is backwards-compatible with the old code
(a widened CHECK and a nullable column nothing writes yet), so there is no reason to
sequence it the other way.

### Deploy-time caution

After deploy, the **first** sheet sync on an existing individually-paid registration
emails everyone on that sheet who has no `sent_at` stamp. Verified footprint in prod:

```
2 registrations with member_pays_individually = true
  uruguay-environmental-design-challenge      details_method=spreadsheet  amount_due=0  1 participant  @insimeducation.com
  minnesota-environmental-design-challenge-2026  details_method=spreadsheet  amount_due=0  1 participant  @gmail.com
All 15 participants in prod have individual_payment_status = NULL
0 active sheet_watch_channels → the Drive webhook cannot fire spontaneously
```

Both are internal/test addresses and both are free events, so blast radius is one
"no payment required" email each, and only on a **manual** "Sync From Sheet" click.

---

## Files changed

**New**
```
lib/individual-payment.ts
lib/individual-payment.test.ts          6 tests
lib/docusign-agreements.test.ts         7 tests
supabase/migrations/137_individual_payment_waived.sql
```

**Modified**
```
app/(public)/register/[slug]/group/page.tsx        passes isFree
app/api/register/group/route.ts                    branch ungated; invoice guard; seatPayStatus
app/api/register/group-join/route.ts               inline Stripe block → helper
app/api/members/teams/[id]/participants/route.ts   + helper call
app/api/members/teams/[id]/sheet-sync/route.ts     returns paymentLinksSent
app/api/webhooks/google-sheets/route.ts            logs paymentLinksSent
app/api/stripe/webhook/route.ts                    NULL counts as outstanding
components/forms/GroupRegistrationForm.tsx         isFree prop; free-event panel
components/member/TeamsTab.tsx                     'waived' pill
components/member/BillingHistory.tsx               'waived' pill
lib/docusign-agreements.ts                         3-check dedupe + email fallback
lib/sheet-participant-sync.ts                      + helper; dedupe moved out
lib/email.ts                                       + groupRegisteredNoPaymentEmail
lib/payment-status.ts                              'waived' is settled
lib/payment-status.test.ts                         + 2 tests
```

---

## Open items

See the tabulated tracker (Google Doc, *Session Close-Out — Group Individual
Payment*). Summary, highest first:

1. **UNCOMMITTED follow-up work exists on the working tree** — the free-event
   `status='confirmed'` fix (plus `finalizeRegistrationMerch` on that path), the
   `waived` roster pill, and the `paymentPill()` extraction into
   `lib/payment-status.ts` with tests. Written and green (tsc, 197 tests, ds-lint)
   but **not committed**, because the checkout sat on `feat/teacher-onboarding-2026-08-13`
   — a parallel session's unpushed branch carrying 25 lines in
   `app/api/register/group/route.ts` that are not on `origin/main`. Branching from
   `origin/main` and carrying the tree over would drop those lines. Land it either
   on that branch, or on a fresh branch applying only these hunks.
2. **Runtime-verify the sheet-sync → payment-link path.** It's a money path and has
   only ever been exercised against stubs — no real Stripe, Resend, or Sheets call.
   Now doubly worth doing, since it ran against a broken schema in prod for a window.
3. **15 prod participants sit at `NULL` status.** Deliberately not backfilled (demo
   data). Decide whether to clear them or leave them. Note the webhook now counts
   `NULL` as outstanding.
4. **`groupRegisteredNoPaymentEmail`** — rendered and diffed against the shipped
   payment email (chrome byte-identical); never seen in a real mail client.

### Resolved since this doc was first written

- Free-event `status='pending'` and the admin "Paid" pill — fixed in the uncommitted
  work under item 1.
- The email render — done.
- **`notifyCommunityAdmins` reached nobody.** `staff_roles` held one row scoped
  `['events']` on a test account, which silenced the new waive alert *and* the
  pre-existing missing-guardian alert in `dispatchAgreement` — a minor with no
  guardian on file produced no envelope and no notification. Fixed 13 Aug 2026:
  `david.shaw@stellreducation.org` granted `community` via `/admin/staff`.
  Worth knowing: that screen's save **replaces** a member's scopes rather than
  merging, so re-select everything they should keep when editing an existing row.
