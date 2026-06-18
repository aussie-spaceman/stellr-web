# Web Store — Implementation Plan

Implementation plan for the Stellr web store (PRD §12). Built **natively** inside the
existing Next.js + Supabase + Stripe app — no Shopify. POD fulfilment via **Printful**.
Designed to be executed phase-by-phase by Claude Code build sessions; each phase is
independently deployable and verifiable.

**Source of truth:** PRD §12 (Web Store). **Status:** planned, not started.
**Migration:** `051_web_store.sql`. It sits alongside sibling migrations `050`,
`052`, `053` added by the concurrent cohort/mentoring/chat work (sequence
`049 → 050 cohort → 051 web store → 052 → 053`); latest *applied* is `049`.

---

## 1. Decisions baked in

- **Provider:** Printful only.
- **Build:** native module on the existing stack; reuse the Stripe customer, the
  `app/api/stripe/webhook` router, `member_activity_log`, the admin-module pattern, and
  the service-role RLS convention.
- **Two fulfilment timings:** *direct* (Printful order placed at payment) vs *batched*
  (paid up front, fulfilment deferred to a single bulk order someone commits later).
- **Three ship-to destinations:**

  | Mode | Destination | Committed by | Refundable? |
  | --- | --- | --- | --- |
  | Direct-to-consumer (storefront / anytime) | member home address | n/a (auto on payment) | yes, per Printful |
  | Event-batched (live event: included shirt + add-ons) | event venue | Event Manager | no, once batch committed |
  | Educator campaign bulk-buy | **school address** | educator (Teacher / Student Manager) | no, once batch committed |

- **Included shirt:** $0 line item auto-allocated to every confirmed participant, size from
  `members.tshirt_size`; appears in portal, batch, and check-in screen.
- **Discounts (two non-stacking axes):** membership-tier discount in the storefront; event
  merch discount as global default + per-event override (mirrors the `refund_policies`
  engine, migration 027).
- **Purchase history:** surfaces in the member portal **Activity History**
  (`member_activity_log`), not a separate tab.
- **Returns:** event/campaign batch merch is non-refundable once committed; general store
  merch refundable per Printful.
- **Non-attendance:** uncollected event-batch merch is **reshipped at cost to the member's
  home address** (member pays the reship/shipping cost via a new Stripe charge).
- **Guest checkout** or create-free-account-at-checkout (reuse existing auto-account flow).

---

## 2. Data model — migration `051_web_store.sql`

All tables: `ENABLE ROW LEVEL SECURITY` + single `"service role full access <table>" … FOR ALL TO service_role` policy (per migration 049). No authenticated/public policies — all access is server-side via `supabaseServer()`.

```
store_products
  id uuid pk, slug text unique, name text, description text,
  product_type text,                      -- apparel | merch | sticker | digital
  status text default 'draft',            -- draft | active | archived
  pod_provider text default 'printful',
  pod_sync_product_id text,               -- Printful sync product id
  images jsonb default '[]',
  is_event_shirt boolean default false,   -- candidate for "included shirt"
  featured boolean default false, created_at timestamptz default now()

store_variants
  id uuid pk, product_id uuid fk -> store_products,
  sku text unique,                        -- the central SKU
  label text,                             -- "Black / L"
  options jsonb,                          -- {size:'L', color:'Black'}
  market_price_cents int,                 -- storefront/default price
  pod_sync_variant_id text,               -- Printful sync_variant_id (order line ref)
  inventory_qty int,                      -- null = POD/unlimited
  active boolean default true

store_tier_discounts                      -- axis 1: storefront tier pricing
  id uuid pk, tier_id uuid fk -> membership_tiers,
  scope text,                             -- all | product | category
  product_id uuid null, category text null,
  percent_off int                         -- 0-100

store_event_discounts                     -- axis 2: event/campaign merch (mirrors refund_policies)
  id uuid pk,
  scope text,                             -- global | event
  event_slug text null,                   -- null when global
  product_id uuid null, category text null,  -- null = applies to all
  percent_off int                         -- 100 = free (the included shirt)

event_store_offerings                     -- which products an event offers, and how
  id uuid pk, event_slug text, variant_id uuid fk -> store_variants,
  treatment text                          -- included | addon

merch_batches                             -- bulk fulfilment unit (event venue OR campaign/school)
  id uuid pk,
  batch_type text,                        -- event_venue | educator_campaign
  event_slug text,
  owner_member_id uuid null,              -- educator who owns a campaign batch
  ship_to jsonb,                          -- venue (event) or school address (campaign)
  status text default 'open',             -- open | committed | ordered | shipped | received
  pod_order_id text, tracking_url text,
  committed_by uuid null, committed_at timestamptz null, created_at timestamptz default now()

store_orders
  id uuid pk, member_id uuid null,        -- null = guest
  email text, status text default 'pending',  -- pending | paid | fulfilling | shipped | delivered | refunded | cancelled
  channel text,                           -- storefront | event_registration | educator_bulk | reship
  event_slug text null,
  stripe_checkout_session_id text, stripe_payment_intent_id text,
  subtotal_cents int, discount_cents int, shipping_cents int, tax_cents int, total_cents int,
  ship_to jsonb null,                     -- home address for direct/reship; null for batched
  created_at timestamptz default now()

store_order_items
  id uuid pk, order_id uuid fk -> store_orders,
  variant_id uuid fk -> store_variants, sku text, name text,  -- snapshot
  qty int, unit_amount_cents int, line_source text,           -- storefront | event_included | event_addon | reship
  fulfillment_mode text,                  -- direct | batch
  fulfillment_status text default 'pending', -- pending | awaiting_batch | ordered | shipped | collected | reshipped | cancelled
  batch_id uuid null fk -> merch_batches,
  participant_member_id uuid null,        -- whose item this is (event context)
  collected_at timestamptz null

member_addresses                          -- direct/reship only
  id uuid pk, member_id uuid fk -> members,
  label text, line1 text, line2 text, city text, state text, postcode text,
  country text default 'US', is_default boolean default false

store_returns
  id uuid pk, order_id uuid, member_id uuid, reason text,
  status text,                            -- requested | approved | refunded | denied
  stripe_refund_id text, created_at timestamptz default now()
```

Also add to the existing participant/registration record (or a small join): `merch_collected boolean default false`, `merch_collected_at timestamptz` for the check-in screen.

**Deletion subsystem:** register `store_orders`, `store_order_items`, `member_addresses`,
`store_returns` in `lib/deletion` (migration 026 framework) with dependency-aware blocking
(can't hard-delete a member with an open/uncommitted batch line).

---

## 3. Pricing & discount resolution (server-side)

`lib/store/pricing.ts → computeUnitPrice(variant, context, member)`:

1. Base = `variant.market_price_cents`.
2. **Storefront / anytime context:** if buyer has an active tier, apply best matching
   `store_tier_discounts` (`percent_off`). Guests pay base.
3. **Event/campaign context:** ignore tier; apply `store_event_discounts` — per-event
   override (`scope='event'` + matching `event_slug`) wins over `global`. `100` ⇒ free.
   The included shirt is the event's `treatment='included'` offering at effectively 100%.
4. Axes **do not stack** — event context uses event policy only; storefront uses tier only.
5. Final amounts feed Stripe Checkout **`line_items` with `price_data`** (inline amounts) —
   no per-event Stripe Price objects needed.

---

## 4. Phases

### Phase 0 — Foundations
- Create Printful store; generate API token. Add env: `PRINTFUL_API_KEY`,
  `PRINTFUL_STORE_ID`, `PRINTFUL_WEBHOOK_SECRET`. (Reuse `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `TRANSACTIONAL_FROM`.)
- Migration `051` (section 2). `mcp supabase apply_migration` after local review.
- `lib/store/printful.ts` — client + `createOrder`, `getShippingRates`,
  `listSyncProducts`, `verifyWebhook`. `lib/store/auth.ts` — `canManageStore` (admin),
  `canManageBatch` (admin/Event Manager for events; educator-owner for campaign batches —
  reuse `ownsTeam`/`currentUserHasScope`).
- **Verify:** types generate clean; Printful client lists sync products in a script.

### Phase 1 — Admin catalog + discounts + addresses
- Pages: `app/(admin)/admin/store/page.tsx` (product table), `…/store/[id]/page.tsx`
  (edit), `…/store/new/page.tsx`. Model on `app/(admin)/admin/membership/`.
- API: `app/api/admin/store/products/route.ts` (GET/POST), `…/products/[id]/route.ts`
  (GET/PATCH/DELETE), `…/products/[id]/sync/route.ts` (pull Printful sync variants →
  `store_variants`), `…/discounts/route.ts` (tier + event discount editors).
- Components: `components/admin/store/ProductTable.tsx`, `ProductForm.tsx`,
  `DiscountMatrix.tsx` (event-discount editor styled like the refund-policy UI),
  `StoreNav.tsx`. `member_addresses` CRUD on the account/profile edit surface.
- `lib/store/products.ts`, `lib/store/discounts.ts`. Log catalog edits via `logActivity`.
- **Verify:** create a product, sync Printful variants, set a tier discount + a per-event
  override; confirm `computeUnitPrice` returns expected amounts in a unit test/script.

### Phase 2 — DTC storefront + checkout
- Public: `app/(public)/store/page.tsx` (grid), `…/store/[slug]/page.tsx` (detail).
  `components/ui/ProductCard.tsx` (model on `EventCard.tsx`), `components/store/*`
  (variant picker, cart summary, checkout button). Tailwind brand tokens.
- API: `app/api/store/checkout/route.ts` — builds a `store_order` (pending) + Stripe
  Checkout Session (`metadata.type='store_order'`, `orderId`), `mode:'payment'`,
  `shipping_address_collection`, `shipping_options` (Printful live rates or flat-rate to
  start), tier discount applied via `price_data`. Guest or logged-in (Clerk `auth()`).
- Webhook: extend `app/api/stripe/webhook/route.ts` — on `checkout.session.completed`
  with `type='store_order'` → mark order paid, capture `payment_intent`, create a **direct**
  Printful order to `ship_to`, write `member_activity_log` (`category:'purchase'`,
  `action:'order_placed'`/`'payment_received'`), send confirmation email.
- Printful webhook: `app/api/printful/webhook/route.ts` — `package_shipped` →
  set item/order `shipped` + tracking + activity log; `order_failed` → alert admin.
- **Verify (preview tools):** complete a test checkout (Stripe test mode), confirm the
  order row, the Printful order creation (sandbox), the activity-log entry, and the email.

### Phase 3 — Event integration (registration-time)
- Sanity event schema: link products via `event_store_offerings` (one `included`
  offering = the shirt; zero+ `addon` offerings). Admin sets these per event.
- Included shirt: in the existing `confirmRegistration` path, for each confirmed
  participant create a `store_order_items` row — `line_source='event_included'`,
  `unit_amount_cents=0`, `fulfillment_mode='batch'`, size from `members.tshirt_size`,
  `participant_member_id` set, `fulfillment_status='awaiting_batch'`.
- Add-ons: registration UI shows `addon` offerings at event-discounted price; selections
  ride the **same** registration Stripe Checkout session. On payment, create a
  `store_order` (`channel='event_registration'`, `event_slug`) + `event_addon` items
  (`mode='batch'`, `awaiting_batch`). No Printful order yet.
- Educator campaign bulk-buy: `app/(member)/…/teams` or campaign view → educator picks
  products/qtys → Stripe Checkout (`channel='educator_bulk'`) → items
  (`mode='batch'`, `awaiting_batch`) attached to an `educator_campaign` batch (ship_to =
  school address from `member_schools` → `schools`).
- **Verify:** register an individual minor for an event → included shirt line item appears
  sized correctly; buy an add-on → `awaiting_batch` item created, no Printful order fired.

### Phase 4 — Batch fulfilment + check-in
- Event batch UI: tab on `app/(admin)/admin/events/[slug]` ("Merch") — aggregates all
  `awaiting_batch` items for the event (included + add-ons), grouped by participant; shows
  ship-to = venue (from Sanity event). Educator batch UI: equivalent view in the educator's
  Team/portal area; ship-to = school address.
- Commit: `app/api/admin/events/[slug]/merch/commit/route.ts` (and educator equivalent) —
  creates **one** Printful order with all items + `ship_to`, stores `pod_order_id`, flips
  `merch_batches.status='ordered'` and items → `ordered`. **Locks event-merch refunds.**
  Printful webhook → `shipped` + tracking on the batch.
- Check-in: extend the QR check-in confirmation screen (currently name + shirt size) to
  list the participant's merch (included + add-ons) and a **"Mark collected"** toggle →
  sets `merch_collected` + item `collected_at`, logs activity.
- **Verify:** commit a batch → single Printful order to venue; check-in screen shows merch
  and the collected toggle persists.

### Phase 5 — Returns, refunds, reship-at-cost
- `lib/store/returns.ts`. DTC return/refund: `app/api/store/returns/route.ts` → Stripe
  refund + Printful return per policy; record `store_returns`; activity log.
- Event/campaign merch: block refund when its `batch.status` is `committed`+; allow refund
  of an add-on payment only if requested **before** commit.
- **Reship at cost (non-attendance):** after an event, items with
  `merch_collected=false` (event passed) are flagged uncollected. `app/api/store/reship/route.ts`
  → confirm/collect `member_addresses` home address → Stripe charge for the reship cost
  (Printful shipping for a single home order; included-shirt item itself already paid) →
  create a **direct** Printful order to home → items → `reshipped`. Member-initiated from
  the portal or admin-initiated. (If a leftover physical item exists at the venue, the
  alternative is manual ship by staff — Printful drop-ship is the default automated path.)
- Store return-policy page (public) + member-portal copy.
- **Verify:** pre-commit add-on refund works; post-commit refund is blocked; an uncollected
  item triggers a reship charge + a new home-bound Printful order.

---

## 5. Cross-cutting

- **Stripe webhook additions:** `type='store_order'` (DTC), plus add-on settlement folded
  into the existing registration `confirmRegistration` path. Reuse `members.stripe_customer_id`.
- **Printful webhook:** new `app/api/printful/webhook/route.ts`; handle `package_shipped`,
  `order_failed`, `order_canceled`; verify via `PRINTFUL_WEBHOOK_SECRET` / store id match.
- **Activity log categories:** `purchase` (or reuse `billing`) — actions `order_placed`,
  `payment_received`, `merch_collected`, `order_shipped`, `refund_issued`, `reship_charged`.
- **RLS:** service-role only on every new table.
- **Env vars:** `PRINTFUL_API_KEY`, `PRINTFUL_STORE_ID`, `PRINTFUL_WEBHOOK_SECRET`.

## 6. Refundability matrix

| Item | Refundable | Cutoff |
| --- | --- | --- |
| DTC storefront merch | yes | Printful return window |
| Event add-on | yes (refund payment) | only **before** batch committed |
| Event included shirt | no (cost in event fee) | — |
| Campaign bulk merch | no | only before batch committed |
| Uncollected event merch | not refunded → **reshipped at cost** to home | post-event |

## 7. Rollout / ops checklist

- [ ] Printful store + designs (sync products) created; `pod_sync_variant_id` mapped.
- [ ] Stripe shipping rates / tax (enable Stripe Tax if collecting US sales tax) decided.
- [ ] Env vars set in Vercel.
- [ ] Migration `051` applied (`supabase db push` from repo root).
- [ ] Stripe + Printful webhooks registered and verified.
- [ ] Store tables added to the deletion subsystem.
- [ ] Per-event offerings + venue ship-to populated for the first live event.

## 8. Still to confirm (non-blocking)

- Does tier discount ever apply to **add-ons** bought during registration, or is event
  context always tier-blind? (Plan assumes tier-blind in event context.)
- Reship cost = shipping only, or shipping + a handling fee? (Plan charges Printful cost.)
- Sales tax / nexus handling for physical goods (Stripe Tax recommended).
