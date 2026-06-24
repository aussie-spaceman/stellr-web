# Workshops & Cohorts — Access, Grants & Purchase (Implementation Plan)

**Status:** FULLY BUILT (backend + APIs + member/admin UI) 2026-06-24 · tsc + next build clean · migrations 078/079/080 PENDING `supabase db push` · ops + functional test outstanding (see "Build status" below)

## Build status (2026-06-24)
**Done (committed to working tree, uncommitted):**
- **Rec 1** — migration `078`; shared wallet core `lib/credits.ts` (`syncAllowance`/`getCredits`/`consumeOldestCredit`/`grantCredits`, typed by `CreditType`); `lib/mentoring.ts` delegates to it; admin per-tier **workshop credits/yr** column wired through `listMentoringTiers`/`updateTierMentoring` → API → `MembershipAccess.tsx` → membership page.
- **Rec 3** — migration `079` (+ `platform_pricing` table & `lib/pricing.ts`); `lib/workshops.ts` (discover/access/enroll/refund for `container_type='workshop'`, `workshop` credits); routes `app/api/community/workshops/{register,topup}`; Stripe webhook branches `workshop_enrollment` + `workshop_topup`.
- **Rec 2** — migration `080`; `applyGrantTrigger` credits branch + `TriggerContext.grantKeySeed`; `GrantRule` extended; trigger seeds wired (`competition_registration`→eventSlug, `event_attendance`/`event_award`→participation id); rules API (`/api/admin/membership/rules`) validates/persists credit grants; `RulesClient.tsx` editor supports Tier vs Credits.

**UI — now built (2026-06-24):**
- Workshop **member UI**: landing `/community/workshops` (your workshops + dual-balance wallet widget), `/community/workshops/discover` (grid + register modal + top-up), `/community/workshops/[workshopId]` detail (sessions + roster, or register prompt). Components `WorkshopDiscoverGrid` + `TopUpWorkshopCredits`. Sidebar "Workshops" link added.
- Workshop **admin console**: `/admin/community/workshops` — list + create/edit modal (coach picker, flat price prefilled from `platform_pricing`, free-for-tiers, credit cost, open toggle) + archive/delete; **`platform_pricing` editor** inline. `lib/workshops.ts` admin fns + `/api/admin/community/workshops`. AdminSidebar "Workshops" link added.
- **C1 gate** (`lib/access-gates.ts` `reportEnrollmentGate`): minor participation-agreement check wired into all cohort + workshop enroll paths, REPORT-ONLY unless `ACCESS_GATES_ENFORCE=true` (consistent with the competition gates). New `EnrollResult` reason `'needs-agreement'` surfaced in the register routes.

**Ops before live:** run `supabase db push` (078→080); set per-tier workshop grants + `platform_pricing` values in admin; optionally `WORKSHOP_CREDIT_PRICE_CENTS`; functional test the buy + grant flows.

---

**Original status:** PROPOSED 2026-06-24 · not started
**Goal:** Let members gain access to **coaching workshops** and **mentoring cohorts** by two routes:

1. **Granted** — earned by participating in an event, or included with a membership tier (a fixed quantity, or "free with tier").
2. **Purchased** — bought directly (one-off, or a credit pack to spend later).

**Constraints (confirmed with product):**
- Members can be **any age bracket** — access mechanics must be age-agnostic; minors still pass the existing participation-agreement / payment gates.
- **Static pricing first:** one flat price for any cohort, another flat price for any workshop (regardless of sessions/duration). Must evolve to **per-container variable pricing** later **without schema change**.

This plan is built in the recommended execution order **Rec 1 → Rec 3 → Rec 2** (the dependency order: wallet first, then the thing to sell, then the rules that grant into it).

---

## What already exists (verified in code)

| Capability | Where | Reuse |
|---|---|---|
| Mentoring cohort = `mentoring_cohorts (container_type='mentoring')` with `credit_cost`, `one_off_price_cents`, `one_off_stripe_price_id`, `free_for_tier_ids`, `is_open` | [migration 070](../supabase/migrations/070_mentoring_redesign.sql) | These pricing columns physically exist on **every** row of the table regardless of `container_type` — workshops get them for free. |
| Credit wallet ledger `session_credits` (`session_type`, `status` available/consumed, `source` allowance/purchase/topup, `consumed_cohort_id`, `grant_key`) | [migration 070 §3](../supabase/migrations/070_mentoring_redesign.sql), [lib/mentoring.ts:38-97](../lib/mentoring.ts) | FIFO consume, rollover, refund-to-available, top-up — all implemented. Hardcoded to `session_type='mentoring'`. |
| Per-tier annual credit grant `membership_tiers.mentoring_credits_grant` + free toggle `includes_free_mentoring` | [migration 070 §2](../supabase/migrations/070_mentoring_redesign.sql), [lib/mentoring.ts:882-937](../lib/mentoring.ts) | Drives the "tier includes N" path. Admin-editable. |
| One-off cohort purchase via Stripe (`metadata.type='mentoring_cohort'`) → `enrollAfterPayment` | [register route](../app/api/community/mentoring/register/route.ts), [webhook:330-344](../app/api/stripe/webhook/route.ts) | Mirror exactly for workshops. |
| Credit-pack top-up (`metadata.type='mentoring_topup'`) | [topup route](../app/api/community/mentoring/topup/route.ts), [webhook:345-360](../app/api/stripe/webhook/route.ts) | Mirror for workshops. |
| Grant-rules engine `tier_grant_rules` + `applyGrantTrigger()` / `grantTier()`; triggers incl. `event_attendance`, `competition_registration`, `tier_purchased`; student fan-out | [migration 061](../supabase/migrations/061_grant_rules_extension.sql), [lib/membership-grants.ts](../lib/membership-grants.ts) | Grants a **tier** only. Extend to grant a **quantity of credits**. |
| Coaching containers exist as 1:1 backfills `container_type='coaching'` | [migration 064](../supabase/migrations/064_coaching_containers.sql) | Legacy 1:1; **not** the group workshops we're selling — keep separate (see Decision D1). |

### The three gaps this plan closes
1. The wallet is wired **mentoring-only** even though `session_type` already carries `'coaching'` — workshops have no credit type.
2. **Coaching workshops are not a purchasable, discoverable, multi-seat product** — only 1:1 backfill containers exist, with no buy/enroll/discover flow.
3. The grant engine **cannot grant a quantity of anything** (only a tier), so "earn N workshops/cohort seats from an event" is inexpressible.

---

## Key design decisions (confirm before building)

- **D1 — Workshop container type.** Introduce `container_type='workshop'` for group, multi-seat, priced, discoverable coaching workshops; leave `container_type='coaching'` for the legacy 1:1 backfills. Keeps discover queries clean and avoids mixing 1:1 rows into the catalogue. *(Verify `mentoring_cohorts.container_type` has no restrictive CHECK — it is free text per the 040/062 convergence.)*
- **D2 — Credit types.** The wallet's type axis stays `session_credits.session_type`. Cohort credits = `'mentoring'` (existing). Workshop credits = **new value `'workshop'`**. 1:1 coaching extra-session credits remain `'coaching'`. Separate types = separate balances = separate prices (satisfies "one price for cohort, another for workshop").
- **D3 — Grant source.** Add `session_credits.source = 'grant'` (alongside allowance/purchase/topup) for credits handed out by a rule (event/tier). Refund logic already returns any non-`purchase` credit to balance, so `'grant'` credits behave correctly on cohort/workshop cancellation.
- **D4 — "Tier includes N" path.** Use a **per-tier annual grant column** (extend the existing `mentoring_credits_grant` pattern with `workshop_credits_grant`) for "this tier includes N per year." Use the **rules engine** (Rec 2) for event-earned and conditional grants. Two mechanisms, same wallet — mirrors how mentoring already works.
- **D5 — Pricing config.** A single-row `platform_pricing` settings table holding the flat default cohort price, workshop price, and credit-pack unit prices. Container rows seed their `one_off_price_cents`/`credit_cost` from these defaults at create time; per-row columns already exist, so moving to variable pricing later is a data edit, **no migration**.

---

## Rec 1 — Generalise the credit wallet (cohort + workshop)

**Outcome:** one wallet, two credit types, all existing machinery (balance, FIFO consume, rollover, top-up, refund) parameterised by credit type. Foundation for everything else.

### 1.1 Migration `078_credit_wallet_generalize.sql`
- If `session_credits.session_type` has a CHECK constraint, drop & re-create it to include `'workshop'`. *(Verify base DDL in 021/070 first.)*
- `ALTER TABLE membership_tiers ADD COLUMN IF NOT EXISTS workshop_credits_grant integer NOT NULL DEFAULT 0;`
- `ALTER TABLE session_credits` — re-create the `source` CHECK to add `'grant'`: `('allowance','purchase','topup','grant')`.
- No data backfill needed.

### 1.2 Refactor `lib/mentoring.ts` credit functions to be type-parameterised
Extract the credit core into a small **`lib/credits.ts`** so both products share it (avoid copy-paste drift):

```ts
export type CreditType = 'mentoring' | 'workshop'           // wallet axis (D2)
const TIER_GRANT_COL: Record<CreditType,string> =
  { mentoring: 'mentoring_credits_grant', workshop: 'workshop_credits_grant' }

syncAllowance(member, creditType)        // generalise syncMentoringAllowance (lib/mentoring.ts:38-82)
getCredits(member, creditType)           // generalise getMentoringCredits   (lib/mentoring.ts:85-97)
consumeOldestCredit(memberId, creditType, containerId)  // FIFO body of enrollWithCredit (lib/mentoring.ts:313-327)
grantCredits(memberId, creditType, qty, { source, grantKey, stripeSessionId })  // NEW — idempotent insert (see Rec 2)
```

- Keep `syncMentoringAllowance` / `getMentoringCredits` as thin wrappers calling `…('mentoring')` so existing callers/UI are untouched.
- `grantCredits` mirrors `syncMentoringAllowance`'s idempotency: count existing rows for `grant_key` + `session_type`, insert only the missing delta. Safe under webhook retry.

### 1.3 Admin
- Membership & access table ([lib/mentoring.ts:882-937](../lib/mentoring.ts) `listMentoringTiers` / `updateTierMentoring`): add a **Workshop credits/yr** column beside the existing mentoring one. Extend `MentoringTier`, the select list, and the `updateTierMentoring` patch (`workshopCreditsGrant`).

**Done = a member's tier can grant annual *cohort* and *workshop* credits independently, both spendable from one wallet.** (Delivers the "tier includes N" half of use-case 1.)

---

## Rec 3 — Workshops as a first-class purchasable container

**Outcome:** workshops become discoverable, buyable, multi-seat containers that mirror mentoring cohorts. Delivers **use-case 2 (purchase)** for workshops and the enrollment surface for use-case 1.

### 3.1 Migration `079_workshop_containers.sql`
- No new columns — 070 already added pricing/discover columns to `mentoring_cohorts`.
- Add a partial open-index for workshops:
  `CREATE INDEX IF NOT EXISTS mentoring_cohorts_open_workshop_idx ON mentoring_cohorts(is_open) WHERE container_type='workshop';`
- Seed `platform_pricing` (D5) and a backfill note (none of the legacy `coaching` rows become workshops — they stay 1:1).

### 3.2 `lib/workshops.ts` (mirror of the mentoring access/enroll surface)
Reuse the shared credit core (Rec 1) and copy the **access/enroll** subset of `lib/mentoring.ts`, swapping `container_type='mentoring'` → `'workshop'` and credit type `'mentoring'` → `'workshop'`:
- `getWorkshopFull`, `listOpenWorkshops`, `resolveWorkshopAccess` ← from [lib/mentoring.ts:198-280](../lib/mentoring.ts)
- `enrollWithWorkshopCredit`, `enrollWorkshopFree`, `addToRosterActive` ← from [lib/mentoring.ts:288-341](../lib/mentoring.ts)
- `enrollWorkshopAfterPayment` ← from [lib/mentoring.ts:1217-1230](../lib/mentoring.ts)
- `refundWorkshopMembers` ← from [lib/mentoring.ts:654-703](../lib/mentoring.ts)

> Implementation note: prefer lifting these into a `container-access.ts` helper parameterised by `{ containerType, creditType }` and have `lib/mentoring.ts` + `lib/workshops.ts` both call it, rather than duplicating ~150 lines. The mentor-dashboard/admin-stats functions in `lib/mentoring.ts` can stay mentoring-specific for now.

### 3.3 Routes (mirror the mentoring ones)
- `app/api/community/workshops/register/route.ts` — clone of [mentoring register](../app/api/community/mentoring/register/route.ts); methods `free | credit | paid`; Stripe metadata `type='workshop_enrollment'`.
- `app/api/community/workshops/topup/route.ts` — clone of [topup](../app/api/community/mentoring/topup/route.ts); metadata `type='workshop_topup'`; unit price from `platform_pricing` (D5) / `WORKSHOP_CREDIT_PRICE_CENTS`.

### 3.4 Stripe webhook — two new metadata branches
In [webhook:299-360](../app/api/stripe/webhook/route.ts) add beside the mentoring branches:
- `type==='workshop_enrollment'` → `enrollWorkshopAfterPayment(memberId, workshopId, session.id)` + log + `persistStripeCustomer`.
- `type==='workshop_topup'` → `grantCredits(memberId, 'workshop', qty, { source:'topup', stripeSessionId: session.id })`.

### 3.5 Admin + member UI
- Admin: a Workshops console mirroring the cohorts admin (create/edit with mentor=coach, flat price prefilled from `platform_pricing`, `is_open`, `free_for_tier_ids`, credit cost). Reuse the cohort CRUD components.
- Member: a workshops Discover list + a wallet widget showing **both** balances (cohort credits / workshop credits).

**Done = a member can discover a workshop and join it free-with-tier, with a workshop credit, or by one-off Stripe payment; admins manage workshops like cohorts.**

---

## Rec 2 — Quantity ("credit-pack") grants in the rules engine

**Outcome:** events and tier purchases can grant a **fixed quantity** of cohort/workshop credits into the wallet. Delivers the "earned by participating in an event" half of use-case 1 (and an alternative tier path).

### 2.1 Migration `080_grant_rules_credits.sql`
```sql
ALTER TABLE tier_grant_rules
  ADD COLUMN IF NOT EXISTS grant_kind text NOT NULL DEFAULT 'tier'
    CHECK (grant_kind IN ('tier','credits')),
  ADD COLUMN IF NOT EXISTS grant_credit_type text
    CHECK (grant_credit_type IN ('mentoring','workshop')),
  ADD COLUMN IF NOT EXISTS grant_quantity integer;
-- Relax grant_tier_id NOT NULL (credit rules leave it null). VERIFY current constraint first.
ALTER TABLE tier_grant_rules ALTER COLUMN grant_tier_id DROP NOT NULL;
-- Optional: seed an example rule (inactive) e.g. "Attend an event → 1 workshop credit".
```

### 2.2 `lib/membership-grants.ts`
- Extend `GrantRule` with `grant_kind`, `grant_credit_type`, `grant_quantity`.
- Extend `TriggerContext` with `grantKeySeed?: string` (idempotency seed — caller passes the event-participation id / source membership id so a credit grant fires **once per event**, not once per webhook retry).
- In `applyGrantTrigger` ([lib/membership-grants.ts:252-318](../lib/membership-grants.ts)), after a rule matches, branch on `grant_kind`:
  - `'tier'` → existing `grantTier` path (unchanged).
  - `'credits'` → `grantCredits(targetId, rule.grant_credit_type, rule.grant_quantity, { source:'grant', grantKey: ``${rule.id}:${ctx.grantKeySeed ?? memberId}`` })`. Honour `grant_target='registered_students'` fan-out exactly as the tier path does (loop the same `registeredStudentIds`).
  - Log an activity entry (`category:'billing'`/`action:'credit_granted'`) mirroring `tier_granted`.

### 2.3 Wire the triggers (already fire — just carry a seed)
- Event participation: [lib/event-participation-sync.ts](../lib/event-participation-sync.ts) already calls `applyGrantTrigger(memberId,'competition_registration',…)` — pass `{ grantKeySeed: eventParticipationId }`. Admin event-participations route ([app/api/admin/members/[id]/event-participations/route.ts](../app/api/admin/members/[id]/event-participations/route.ts)) fires `event_attendance` — pass the participation id.
- Tier purchase: `fireTierPurchased` already fires `tier_purchased` from [webhook activateMembership:244](../app/api/stripe/webhook/route.ts) and admin grant routes — pass `{ grantKeySeed: membershipId, sourceTierId }`.

### 2.4 Admin (Membership Studio rules editor)
- Add a **Grant kind** selector (Tier / Credits). When Credits: show **credit type** (Cohort / Workshop) + **quantity**; hide the tier picker. Persist the new columns.

**Done = an admin can author "attend event X → 2 workshop credits" or "buy Innovator → 1 cohort seat + 3 workshop credits," including student fan-out, all landing in the shared wallet.**

---

## Cross-cutting workstreams

### C1 — Age bracket & access gates (do alongside Rec 3)
Credits/enrollment are member-scoped and age-agnostic — no special handling at the wallet. **But** route every workshop/cohort enrollment (free, credit, or paid) through the existing gate layer ([lib/access-gates.ts](../lib/access-gates.ts)) so a **minor's** seat still respects the participation-agreement / DocuSign and payment gates before the container opens. A credit spend must **not** bypass the minor-agreement gate. Add a gate check in `enrollWith*Credit` / `enroll*Free` before `addToRosterActive`.

### C2 — Refunds on cancellation
`refundCohortMembers` ([lib/mentoring.ts:654-703](../lib/mentoring.ts)) already returns allowance/topup credits to balance and converts one-off purchases to account credit. Generalise it (or clone for workshops) and confirm `'grant'`-sourced credits return to balance (they will — only `'purchase'` becomes account credit).

### C3 — Pricing config (`platform_pricing`, D5)
Single-row settings table: `cohort_price_cents`, `workshop_price_cents`, `cohort_credit_price_cents`, `workshop_credit_price_cents`. Read in the register/topup routes and seeded into container `one_off_price_cents`/`credit_cost` at create. Admin screen to edit the flat defaults. Per-container overrides (existing columns) give variable pricing later with no migration.

---

## Migrations summary
| # | File | Purpose |
|---|---|---|
| 078 | `credit_wallet_generalize.sql` | `session_type` += `'workshop'`; `membership_tiers.workshop_credits_grant`; `source` += `'grant'` |
| 079 | `workshop_containers.sql` | workshop open-index; `platform_pricing` seed |
| 080 | `grant_rules_credits.sql` | `grant_kind`/`grant_credit_type`/`grant_quantity`; relax `grant_tier_id`; example rule |

Apply with `supabase db push` from the repo root (per the [group-rego note] — CLI history reconciled through 077).

## Build order & rough effort
1. **Rec 1** (wallet) — ~1 migration + `lib/credits.ts` extraction + 1 admin column. Low risk, no UI surface change. **Do first.**
2. **Rec 3** (workshops) — mostly mirror of mentoring; the new product surface. Medium. Depends on Rec 1.
3. **Rec 2** (quantity grants) — engine extension + admin editor + trigger seeds. Medium. Depends on Rec 1 (the wallet to grant into) and Rec 3 (so `'workshop'` credits have somewhere to spend).

After Rec 1 + Rec 3 → **use-case 2 (purchase) is live for both products.**
After Rec 2 → **use-case 1 (granted by event/tier) is live for both products.**

## Risks / verify-first
- **CHECK constraints** on `session_credits.session_type`, `session_credits.source`, `tier_grant_rules.grant_tier_id` NOT NULL — confirm exact base DDL before writing 078/080.
- **`session_type` overloading:** extra 1:1 `'coaching'`/`'mentoring'` credits ([webhook:318-329](../app/api/stripe/webhook/route.ts)) share the table; a purchased *extra mentoring session* credit counts toward cohort balance today (pre-existing quirk). Workshops use a distinct `'workshop'` type and are unaffected — but don't reuse `'coaching'` for workshops or you'd collide with 1:1 credits.
- **Idempotency:** every credit grant (allowance, grant, topup, purchase) must key on `grant_key`/`stripe_session_id` so Stripe retries and re-fired triggers never double-credit.
