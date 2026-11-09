<!-- Spec and edge-case rules for group payment options. -->

**Status, 9 Nov 2026:** both phases built and unit-tested on branch `feat/group-payer-subset-invoice`. Migrations `20261109180000_group_payers.sql` and `20261109190000_teacher_share.sql` applied to dev only; production needs both before the code merges.

**Phase 1 as built differs from the plan below in two small ways:**
- A split group keeps `member_pays_individually` false and is marked by `late_joiner_payer` being set (`isSplitGroup`, `lib/group-payer.ts`). An unpaid link of one's own (`individual_payment_status = 'pending'`) reads as owed by that person everywhere (`lib/payment-status.ts`), so most readers of the group flags needed no change.
- People move on and off the invoice in the "How this group pays" dialog (a tick per person), not a per-row menu on the roster. The roster and Teams tab show each person's state ("On the invoice", "Not Yet Paid", "Paid").

**Phase 2 as built differs from the plan below in these ways:**
- A sharing group is an individually paid group (`member_pays_individually` true) with `share_estimate` set. Covered teachers have payer `shared` and status `covered`.
- The pool is the number of covered adults × `share_unit_cents`, a teacher's price when the group chose this, so adding or removing a covered adult moves it without storing a running total.
- One group either invoices some people or shares the teacher's cost, not both at once.
- Settlement runs inside the existing daily `group-invoice-sync` cron (`settleDueShares`), not a new cron.
- Account → Billing and Teams "Pay now" for a sharing group send the student to their seat pay page, which is the one place the share is priced and a code is taken.
- Not enforced by the app: a code's `max_redemptions` (Stripe doesn't see these redemptions, because the place is priced before Checkout).

# Group payments: invoice part of a group, and share a teacher's cost

## Context

A teacher's group for the Minnesota event moved from invoice to individual payment on 9 Nov (#573). Every attendee, the teacher included, now has a pay link. They then asked for "an invoice for just myself". Today a group pays one way only: invoice, card or individual (`billingMode()`, `lib/group-billing.ts:115`). There is no per-person payer.

Two new options, on the public registration page and in the web app (teacher / Teacher POC, assigned event manager, admin):

1. **Invoice part of the group.** Some people go on the organizer's invoice and the rest pay by their own link (the request now; later, for example, teacher + 1 student invoiced and 2 students on links).
2. **Students share the teacher's cost.** The teacher pays nothing directly. Each student's link carries an equal share of the teacher's full price. The share can only go down.

Local `dev` is 10 commits behind `origin/dev`. #573's files only exist there. Work starts from a fresh worktree off `origin/dev` (ship skill).

## Owner decisions (9 Nov)

| Topic | Decision |
|---|---|
| Shortfall (fewer students than estimated, withdrawals) | Stellr absorbs it. Staff see the projected shortfall |
| Students who paid a higher share before it dropped | True-up refund, once, at settlement |
| When settlement happens | The day after the event. After that the share is frozen |
| Teacher added to a spread group | Folds into the shares only while no student has paid a share. After that, the new teacher pays separately (own link, or the invoice) |
| Who carries a share | Every student paying through a group link, scholarship or not. A student who paid before the group switched to spread is not charged and is not counted |
| Leaving spread after shares are paid | Anyone who can change the method may do it. The app refunds every share already paid |
| Later joiners in a mixed group | A group setting the teacher picks: "people who join later pay by: their own link / the invoice" |
| Public form | Presets, plus per-person ticks for "invoice for some" |
| Who can change | Unchanged from #573: staff + teacher/Teacher POC. Student managers are read-only. Discount codes stay admin-only |

## Design: a payer per person

Add a **payer for each participant**. This replaces deriving everything from group flags:

- `group`: on the organizer's invoice (or the card checkout)
- `self`: pays by their own link
- `shared`: an adult whose full price is split across the students' links (option 2)

The group plan becomes a preset over those payers:

| Plan (UI label) | Payers |
|---|---|
| Invoice for everyone | all `group` |
| Card now for everyone | all `group` (card) |
| Everyone pays individually | all `self` |
| **Invoice for some** (new) | ticked = `group`, others `self`; later joiners → group setting |
| **Students share the teacher's cost** (new) | adults `shared`, students `self` |

Mixing is allowed per person (for example, one teacher invoiced and one shared). The maths for each payer type is independent.

Legacy flags stay in step for the ~38 readers (`git grep member_pays_individually|billingMode(|invoice_requested`):
- `invoice_requested` = anyone is `group` on an invoice
- `member_pays_individually` = anyone is `self`

A new `lib/group-payer.ts` is the one source of truth:
- `payerOf(participant, registration)` falls back to the legacy flags when `payer` is null, so existing groups need no backfill.
- `plan(registration, participants)` derives the plan.

Every reader that asks "does this person owe via a link / via the invoice" moves to this helper. `billingMode` gains `'mixed'` and `'shared'`, and its callers are audited one by one.

### Migrations (dev first; prod before the code merges, owner yes per promote skill)
- **Phase 1:**
  - `participants.payer text check in ('group','self','shared')`, nullable
  - `registrations.late_joiner_payer text check in ('group','self')`
- **Phase 2:**
  - `registrations`:
    - `share_estimate int`
    - `share_pool_cents int` (C, fixed per adult when they're added)
    - `share_cents int` (the live ratchet)
    - `share_first_paid_at timestamptz`
    - `share_settled_at timestamptz`
  - `participants`:
    - `base_paid_cents`, `share_paid_cents`, `discount_code`
    - add `'covered'` to the `individual_payment_status` check
  - `event_refunds.kind` gains `'share_true_up'` and `'share_unwind'`
  - Explicit GRANTs per the repo's MCP-migration GRANT rule

## Option 1: invoice part of the group (Phase 1, ships first, unblocks the request)

**Invoice seats** = named `group` payers + (late_joiner_payer = `group` ? max(0, declared − named) : 0).

Today's flow handles the rest unchanged: one invoice line, revision or replacement, 2-minute batched sync, additional invoice once paid (`applyRosterChange`, `settleGroupInvoice`, `reviseGroupInvoice` in `lib/group-billing.ts`).

| Edge case | Rule |
|---|---|
| Unpaid link → invoice | Expire their open Checkout sessions (reuse the closing step in `lib/group-payment-change.ts`); status → null; invoice revised (batched); email "no longer due" (`groupSeatPaymentNoLongerDueEmail`) |
| Invoice (unpaid) → own link | Invoice revised down; `ensureIndividualPayments` sends their link |
| Paid by link → invoice | Refused: "already paid" |
| On a **paid** invoice → own link | Refused (same as #573: only the unpaid balance moves) |
| Moving the last person off the invoice | Invoice voided (existing "no seats left" path); plan becomes "Everyone pays individually" |
| Invoice total would be $0 / under 50¢ | Refused (existing `describeChange` checks) |
| Joiner via join link / Sheet / add, late payer `group`, invoice paid | Existing additional invoice |
| Joiner, late payer `self` | Gets a link (`ensureIndividualPayments`, its 5 callers pass the payer) |
| Group discount code | Applies to invoiced seats. It still auto-applies to links as today (`seatDiscount`) |
| Removing an invoiced person | Existing roster rules (frees the place; refund if paid) |
| Payment in flight on the old path | Existing refusal + `notePaymentAfterMethodChange` alert |
| Card preset with a subset | Out of scope (invoice only for subsets) |

**The group that asked, after Phase 1 ships:** staff open her group's "How this group pays" → Invoice for some → tick the teacher → later joiners: own link. Their pending link is cancelled with an email, and an invoice for their place goes out. STEMCAREERS can be added by an admin through "Invoice & discount…".

## Option 2: students share the teacher's cost (Phase 2)

### The maths
- **C** = Σ full list price of each `shared` adult, fixed at the moment they become `shared`. No coupon ever applies to C.
- **E** = teacher's estimate of students (≥ 1).
- **S** = students currently carrying a share: payer `self`, not withdrawn or removed, not paid before the switch.
- **Live share** `share_cents = min(previous share_cents, floor_cents(C / max(E, S)))`.
  - The `min` is the "only goes down" ratchet. Removing a student never raises the share.
  - Rounding is down to the cent, so the app never collects more than C. The leftover (< S cents) is absorbed.
- **Student pays** = (list price − their coupon, on the place only) + share_cents.
  - Priced when they click the link (today's model). The pay-seat page and Checkout show both lines.
- **Settlement** (day after the event, daily cron): final share f = share_cents.
  - Every paid student with `share_paid_cents > f` gets a partial refund of the difference (`share_true_up`).
  - Then `share_settled_at` is set. After that the share is frozen.
  - Collected = paid students × f ≤ C. The gap is the absorbed shortfall.

Worked example: $97 teacher, E = 4 → $24.25.
- Two pay $24.25. A 5th student joins → $19.40 for the 3 unpaid.
- One unpaid student is removed → stays $19.40.
- After the event the two early payers get $4.85 back each.
- Collected 4 × $19.40 = $77.60. Shortfall $19.40 is absorbed.

### Coupons on the place only
Stripe promotion codes discount the whole Checkout session, and existing coupons (STEMCAREERS, SCHOLARSHIP*) aren't product-restricted. So for spread groups:
- The pay-seat page takes the code itself.
- The server validates it: active, expiry, max redemptions counted by the app, percent or amount.
- Checkout gets two `price_data` lines: "Event place" at the discounted amount, and "Teacher share".
- Code, discount, base and share go in session metadata and are stored on the participant when the webhook marks them paid.

Trade-off: Stripe's own redemption counter doesn't move for these. The app records it.

`lib/refunds/payment-basis.ts` must refund from the stored `base_paid_cents` / `share_paid_cents`. Today it falls back to list price for seat payments.

### Edge cases
| Case | Rule |
|---|---|
| Teacher's own status | `covered` (not owing) from the moment spread starts. Passes the access gate. Pill "Shared by students" |
| E < current students when chosen | Allowed. max(E, S) is used |
| Teacher raises E | Allowed any time (share goes down) |
| Teacher lowers E | Only before the first share is paid |
| Student added (S > E) | Share drops. Open Checkout sessions for the group are expired so nobody pays the old amount. Paid students are trued up at settlement |
| Student removed / withdraws, unpaid | Share unchanged (ratchet). Shortfall absorbed |
| Student removed / withdraws, paid | Refund per the 45-day policy on the place, and the share they paid in full. Share unchanged. Shortfall absorbed |
| Student moved onto the invoice | Stops carrying a share (S drops, ratchet holds) |
| Adult added, no share paid yet | Becomes `shared`. C grows and the share rises once. The ratchet resets |
| Adult added after the first share | Payer `self` (own link), or `group` if moved onto an invoice. Share untouched |
| Shared adult removed | C drops, share drops for unpaid links. Trued up at settlement |
| Last shared adult removed | Group leaves spread (the unwind below) |
| 100% scholarship student | Pays the share only. If the share is under Stripe's 50¢ minimum, it's waived for that student (`waived`) |
| Group with no students declared | Spread isn't offered (needs E ≥ 1 and at least one student declared) |
| Switching into spread when a teacher already paid their own link | Refused for that teacher (they stay `self`, paid) |
| Switching into spread from invoice/card | Existing closing step (void invoice, expire sessions). Students who already paid aren't counted |
| Leaving spread (anyone) | Refund every paid share (`share_unwind`). Unpaid links go back to the place price only. Adults take the new method's payer. Clear the share columns |
| Payment races (old share paid during a drop) | Webhook stores the share from session metadata, not the live value. Any overpayment is trued up |
| Event price changes in Sanity | C stays fixed. A student's place uses the price at click time (as today) |
| Joining after settlement | Pays the frozen f |
| Payer changes after settlement | Refused for `shared` adults (staff-only escape: unwind) |

### Who sees what
- **Teacher:** estimate, current share, students paying, collected.
- **Staff:** the same plus projected shortfall, on the roster group header.
- **Students:** the breakdown on the pay page. Copy says the share "can only go down".

## UI surfaces (`@stellr/web-ui` components, copy per `VOICE.md`, "organizer" spelling)

- **Public form** `components/forms/GroupRegistrationForm.tsx` (picker at :1346):
  - five presets
  - an "On the invoice" tick column for Invoice for some (teacher pre-ticked) plus the later-joiner setting
  - an estimated-students input for spread
- **Server:** an allowlist for `payment_method` in `lib/registration/group/parse.ts`. Today there is none. Pricing rules go in `price.ts`; payers are persisted in `persist.ts`; `respond.ts` collects per payer.
- **Web app:**
  - `components/registration/GroupPaymentMethod.tsx` and `lib/group-payment-change.ts` gain the two plans (preview "What happens", effects, refusals).
  - A "Pays by" column with a per-person menu in `components/admin/EventRoster.tsx` and `components/member/TeamsTab.tsx`.
  - A spread panel.
  - Both `payment-method` routes widen their zod enum and accept `{ payers, lateJoinerPayer, estimate }`.
  - New route `…/participants/[pid]/payer` for single moves (same guards: `requireEventAccess` + `accessCoversEvent`; `teamViewerRole` with student managers 403; `withAudit`).
- **Pay page** `register/[slug]/pay-seat/[token]`: code field + breakdown for spread groups.
- **Emails** (`lib/email.ts`): confirmation and method-changed copy for the new plans; a share-dropped note isn't sent (the link always shows the current price); a true-up refund email.

## Delivery

1. **Phase 1 (option 1):**
   - payer model, `lib/group-payer.ts`, legacy-reader audit
   - invoice-for-some in web app + public form
   - Phase 1 migration
   - Then /ship → /promote. Then move the group that asked (owner clicks or approves).
2. **Phase 2 (option 2):**
   - share maths in a pure module `lib/teacher-share.ts`
   - pay-page coupons, webhook fields, refund basis
   - settlement cron (`app/api/cron/teacher-share-settle`, audit-cap label)
   - unwind
   - Phase 2 migration
3. Document the rules in `docs/PLAN-group-payment-options-2026-11-09.md` (this table set) so support can answer families.

## Verification

- **Unit (vitest, `fakeDb`/`fakeStripe` pattern from `lib/group-payment-change.test.ts`):**
  - `it.each` tables for invoice-seat counts
  - every edge row above
  - the share ratchet (add, remove, teacher add before/after first payment, E edits, rounding, 50¢ waiver)
  - settlement refunds
  - unwind
- **Route tests:** both `payment-method` routes, the payer route, `register/group` branches, pay-seat, and the webhook storing base/share.
- **Stripe test-mode drill** (tsx script against test mode + dev DB, as in #477/#573, since dev events can't price with the test key):
  - mixed invoice revision when people move
  - spread checkout with STEMCAREERS-like code on the place only
  - share drop
  - settlement partial refund
  - unwind refunds
- **Browser:** click Confirm in the dialog on dev (never done for #573), the public form presets, the pay page breakdown; mobile width.
- `npm run lint:tokens`, `lint:pii`, `tsc`, CI e2e.
- **After promotion:** watch the first real split-group change (invoice for one place, that link cancelled) in Stripe + DB.
