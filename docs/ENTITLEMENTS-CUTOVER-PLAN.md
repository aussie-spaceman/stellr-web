# Entitlements Full Cutover — Build Spec

Status: **APPROVED to build** (David, 2026-06-26). Decision = **A · Full cutover**, scoped.

## Locked decisions
- **Scope (blocker 3):** `membership_tiers` stays authoritative for **tier identity**. Entitlements owns **credits / bookings / pricing / discounts** only. We do **not** migrate tier definitions into entitlements.
- **Blocker 1 (`participants` collision):** entitlements is keyed off **`member_id`**. Drop the unconstrained `participant_id` columns. Never FK to `public.participants`.
- **Blocker 2 (access model):** **service-role only** (already true in prod + `lib/entitlements.ts`). Do NOT port the dev project's Clerk-JWT RLS. Keep RLS enabled, no anon/authenticated policies.
- **Coupons:** schema must **allow for** coupons (`discounts`, `coupon_redemptions` retained), but coupons are **post-launch** — not wired into phase-1 flows.

## Key constraint discovered
`entitlements.tier_benefits.tier_code` and `entitlements.discounts.tier_code` FK → `entitlements.tiers.code`. So `entitlements.tiers` **cannot be a view**; it stays a **TABLE kept in sync** with `membership_tiers` (a projection). Tier `code` is the stable join key (e.g. `pathfinder`); name/price/discount columns are synced.

## Current vs target ownership
| Domain | Today (authoritative) | After cutover |
|---|---|---|
| Tier identity | `membership_tiers` | `membership_tiers` (unchanged) → projected into `entitlements.tiers` |
| Tier allowances/discounts | `session_entitlements` + `membership_tiers.academy_discount_percent`/`store_tier_discounts` | `entitlements.tier_benefits` |
| Credits | `session_credits` | `entitlements.entitlements` (quantity ledger) |
| Granting | credit half of `tier_grant_rules` | `tier_benefits` + `member_grant_runs` (tier grants stay in `tier_grant_rules`) |
| Pricing/booking | ad-hoc in 4 checkout routes + `lib/academy-discount` | `lib/entitlements` (`Quote` + `bookings` + `prices`) |
| Stripe webhook | writes `session_credits`/`member_memberships` | single write path → `entitlements` |

---

## Phase 0 — Blocker fixes (cheap, unblocking, low risk)
1. **Drop `participant_id`** from `entitlements.entitlements` and `entitlements.bookings` (empty tables, no FK → zero-cost). *(migration 103)*
2. **Re-sync `entitlements.tiers`** from `membership_tiers` and establish the sync:
   - Build `entitlements.sync_tiers()` (or a trigger on `membership_tiers`) that upserts code/name/group/`annual_price_cents`/`store_discount_pct`/`stripe_price_id`(+monthly)/`is_free` and **deletes** entitlements.tiers rows whose tier no longer exists in `membership_tiers`.
   - **Watch:** `tier_benefits`/`discounts` FK `tier_code`. Before deleting a stale tier (Advisor/Donor/Expert/Luminary), confirm no `tier_benefits`/`discounts` rows reference it (re-point or delete those first).
   - Add `academy_discount_percent` to the projection (entitlements.tiers currently lacks it).
3. **Service-role ruling:** add explicit `… TO service_role USING(true)` policies on all `entitlements.*` for documentation (optional; no-policy is already locked). Do not add Clerk-JWT policies.

## Phase 1 — Tier benefits (replace `session_entitlements`)
- Map each tier's allowance + discounts into `tier_benefits`: included sessions (`kind=coaching_session/mentoring_cohort`, `quantity`, `period`, `validity_days`), academy discount (`kind=discount`, `discount_pct`, `applies_to=academy`), store discount (`applies_to=store`).
- Seed from `session_entitlements` + `membership_tiers.academy_discount_percent` + `store_tier_discounts`.
- `lib/entitlements.ts` reads benefits for "what your tier includes".

## Phase 2 — Credit ledger (replace `session_credits`) — the core
- **Dual-write first:** wherever `session_credits` is written (grants, top-up webhook, allowance) ALSO write `entitlements.entitlements`. Wherever consumed (`sessions/book`, `enrollAfterPayment`) ALSO decrement `quantity_remaining`.
- **Backfill** existing `session_credits` → `entitlements.entitlements` (grouped to quantity rows; preserve `source`/`refundable`/`consumed`).
- **Flip reads** (allowance display, "credits left", consumption checks) to `entitlements`.
- **Retire** `session_credits` writes; keep the table read-only until confidence, then drop.
- `member_grant_runs` records per-period grants from `tier_benefits` → `entitlements`.

## Phase 3 — Booking + pricing (replace the 4 checkout routes' ad-hoc logic)
- Route `coaching/topup`, `mentoring/topup`, `sessions/purchase`, `mentoring/register` through `lib/entitlements` `Quote` → creates `entitlements.bookings`, applies `prices` + tier `discounts` (coupons later).
- **Subsumes the academy-discount helper** I built (entitlements does tier discount natively). Remove `lib/academy-discount` once routes are migrated.
- Stripe webhook → single entitlements write path (grant entitlement / settle booking).

## Phase 4 — Grant-rule split
- Move the **credit-granting** half of `tier_grant_rules` (`grant_kind`/`grant_credit_type`/`grant_quantity`) into `tier_benefits` + the grant engine.
- `tier_grant_rules` keeps **membership-tier** grants only (signup→tier, win→Scholar, etc.).

## Phase 5 — Retire + reconcile
- Drop `session_credits`, `session_entitlements` after parallel-run confidence.
- Reconcile `member_memberships` ↔ entitlements where they overlap (memberships stay; entitlements references them).
- Coupons (`discounts kind=coupon`, `coupon_redemptions`) wired when the coupon feature launches.

## Cross-cutting
- **Webhook is the highest-risk surface** — money. One write path; idempotent via `entitlements.processed_events`.
- Every phase: dual-write → backfill → flip reads → retire, each independently deployable + reversible.
- Validate each phase with the dev project's pgTAP suite where applicable.
- Pre-launch (~3 members) = low data risk; do the structural work now while volumes are tiny.
