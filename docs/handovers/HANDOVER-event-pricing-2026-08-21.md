# HANDOVER — Event page pricing, copy, and event-slug protection

**Date:** 21 Aug 2026 · **Status:** all code MERGED to `main` and LIVE in prod, verified
**Commits:** `df66e73`, `d5450d0`, `f1cae21` → merged `d3eff66`; `1657049`; `91d1b28` → merged `3a420a4`
**Migrations:** 138, 139 — applied to prod
**Verification commands:** `npm run audit:event-prices`, `npm run audit:event-slugs`

---

## 1. What shipped

### Event detail pages (`app/(public)/events/[slug]/page.tsx`)

Live events only — campaigns render `CampaignDetail` and were deliberately untouched.

- **Fee shown twice**: a third hero line under date/location (`🎟️ $75 per participant`) and a
  Price row in the Event Details sidebar, the latter carrying
  *"Large group discounts available — Contact Stellr"*.
- **Standard eligibility copy**, with the grade clause derived from the event's `gradeLevel` so a
  future Middle School event cannot inherit the 9–12 range. The per-event Sanity `eligibility`
  field is **retired** (hidden in Studio, data preserved) — hand-authored notes had already drifted
  (one event still promised "Teams of 4–6 students" against the current 2–12).
- **What's Included** and **How the Challenge Works** sections, above the FAQ.
- **8 FAQs**, mirrored into FAQPage JSON-LD. `a` (React) and `text` (plain) must stay in step —
  schema that disagrees with the visible copy is treated as spam.
- Links in the blocks touched moved `text-brand-blue` → `text-primary-deep` for WCAG AA.

### Pricing model (`lib/event-pricing.ts`)

The fee exists **only as a Stripe price ID**. There is no cents column in Sanity or Supabase, and
public surfaces must never hard-code one (same rule as `lib/tier-pricing.ts`). Four states:

| State | Trigger | Page shows | JSON-LD offer |
|---|---|---|---|
| `tbc` | no price ID | "Pricing TBC" | price omitted |
| `free` | active $0 price object | "Free to enter" | `price: "0"` |
| `priced` | active price > 0 | "$75 per participant" + discount note | resolved amount |
| `unavailable` | price ID missing/inactive in Stripe | nothing | price omitted |

An **inactive** price counts as unavailable: Stripe rejects inactive prices as checkout line items,
so an amount read off one can never be charged.

### The $0-price policy change (`d5450d0`) — read this before touching registration

Free events are now configured as an **explicit $0 Stripe price**; a blank price ID means the fee
is not set yet. Previously the whole registration stack keyed "free" on the *missing ID*, so a $0
price object read as a paid event and broke the flow it was meant to express:

- group form asked how to pay, then the API rejected **card** (total under Stripe's $0.50 minimum)
  *and* **invoice** (total ≤ 0) — no way to register at all;
- individual route built a checkout session for a zero total, which Stripe cannot create;
- per-member payment links were minted for $0 instead of waiving.

All four now key on the resolved amount via `collectsNothing(priceId, resolvedCents)`.

> **A failed price lookup is deliberately NOT free.** The amount stays `null`, never `0`. Treating a
> transient Stripe error as free would confirm registrations for a fee nobody paid, and tell paying
> members they owe nothing. Tests cover both directions — do not "simplify" this to `?? 0`.

### Event-slug protection (migrations 138/139)

`event_slug` is the join key from Sanity into ~15 tables with **no foreign key to Sanity**, so
renaming a slug in the Studio silently strands every row filed under the old value. Three layers:

- **Prevent** — the Studio slug field calls `/api/admin/events/slug-guard`, which compares the
  *published* slug against the proposed one and refuses a rename that would orphan rows. **Fails
  open** on any error: a guard that cannot reach the server must not make the Studio unusable.
- **Detect** — `npm run audit:event-slugs`, wired into `check:deploy-ready`, skipped (not failed)
  without `.env.local`.
- **Repair** — `npm run fix:event-slug -- --from X --to Y [--apply]`, dry-run by default.

All three read their table list from the Postgres catalog, so a table added later with an
`event_slug` column is covered without editing anything.

### Privacy policy (`3a420a4`)

Apollo.io had run in prod since 17 Aug **without the published policy disclosing it**. Now
disclosed: new §9.2 Business-Audience Identification (old 9.2 → 9.3), subprocessor table entry
linking apollo.io/dpa, CPRA section claiming **no-sale only**.

> Two wordings are deliberate. No bilateral Apollo DPA exists or is signable, so the policy
> distinguishes terms *executed with Stellr* from a provider's *own standard addendum*. And CPRA
> now claims no-sale only — **never reintroduce "we do not sell or share"**: with advertising
> consent accepted, technical identifiers are disclosed in a way CPRA treats as "sharing".

---

## 2. Production data repaired this session

- **30 rows** orphaned by same-day slug renames were repointed (Minnesota 15, Nevada 12,
  space-design campaign 3) across `event_refunds`, `registrations`, `store_orders`,
  `event_settings`, `event_companies`.
- **Two Nevada events merged** on David's confirmation that they were the same event
  (`nevada-space-design-challenge-2026` → `nevada-space-design-challenge`, 12 rows + settings).

> **A merge is not a rename.** `event_settings` is PK'd on `event_slug`, and `event_companies`,
> `refund_policies` and `volunteer_event_interest` carry uniqueness on it too — two live slugs
> collide and `fix:event-slug` will abort (safely) rather than reconcile them. Here the surviving
> event's `check_in_token` and `check_in_open` were kept (the token may already be circulating) and
> only `company_count` was carried across, before the old settings row was deleted.

`npm run audit:event-slugs` now reports **zero orphans**.

---

## 3. Open items

### Blocking a real user flow

- **North Carolina** — `price_1TeztlKUgSKucUJEyhlsAAFq` does not exist in the live Stripe account
  (it belongs to a different account or test mode). The fee is hidden on the page **and checkout is
  broken**: the individual route returns a 503 "fee is misconfigured" before any writes. Fix in
  Stripe/Sanity; no code change needed.

### Public-facing but not blocking

- **Rhode Island** — active price of **$0.51**, so the page publicly advertises and would charge
  $0.51. Almost certainly a test price.
- **Uruguay** — no price ID, so the page reads "Pricing TBC" *while its group registration form
  still treats a blank ID as free* and would confirm registrations collecting nothing. Setting a
  price (real or $0) closes the inconsistency.
- **Texas reads "Free to enter", not "Pricing TBC"** as originally instructed — because it was
  given an active $0 price object, which under the new policy is the signal for a deliberately free
  event. Clear its price ID if it is genuinely undecided.
- **Privacy policy stamp** still reads *Last Updated: 17-Aug-2026* (when written) though it
  published on 21 Aug.

### Known deviations from the literal brief

- Section heading renders **"How the Challenge Works"**; the brief wrote "How The Challenge Works".
- "NASA JSC" was expanded to "NASA Johnson Space Center (Houston, TX)".
- The two new sections were described in the plan as "your copy verbatim" but were **lightly edited
  for house style** — typo fixes ("osit" → "or sit", "then winning" → "the winning") were flagged at
  the time, but "invite" → "invitation" and similar tightening were not.
- Two statement-style FAQ titles were phrased as questions to match the other six (flagged and not
  objected to).

### Deferred by agreement

- **Events listing page** (`app/(public)/events/page.tsx`) shows no price — the brief named two
  locations, both on the detail page. Cards could carry a price pill.
- **Site-wide link contrast** — `text-brand-blue` sits at 4.16–4.46:1 on white and on the grey
  panel, under WCAG AA for body text. Only the event-page blocks were fixed; every other page still
  uses the failing pattern.
- **`text-brand-grey-mid` resolves to `#13183A`** — near-ink, not a muted grey (the muted token is
  `text-brand-grey-dark`, `#5A6178`). Other pages using grey-mid for subordinate text are rendering
  it far heavier than intended.
- **Middle School / "Both" eligibility copy is untested** — all 12 Sanity events are High School,
  so `eligibilityCopy()`'s other two branches have never rendered.
- **Nevada's merged data looks like test data** — all 8 registrations are `withdrawn` and one of
  the three companies is named "Bill". Worth confirming before the event goes live.
- **`docs/REC-form-spam-hardening.md`** (committed this session, nothing implemented) carries a P1
  that is independent of spam: **Resend Free is one ~100/day pool** shared by registration
  confirmations, DocuSign notices and drips, and two public forms mail an attacker-supplied address.
  `lib/email.ts` has no daily guard, so a spam run can exhaust the day silently and the first
  symptom is real families not receiving registration email.

---

## 4. Traps worth knowing

- **`npm run audit:event-prices`** is the fastest way to see what every event page will display,
  including which are misconfigured. Run it before and after any Stripe or Sanity price edit.
- **Renaming a Sanity event slug** is now guarded in the Studio, but the guard fails open — if the
  Studio is offline or the API is unreachable, the rename goes through. `audit:event-slugs` in
  `check:deploy-ready` is the backstop.
- **Free ≠ blank.** Anything that reintroduces `!stripePriceId` as the free test will re-break $0
  events. Use `collectsNothing()`.
- **The FAQ JSON-LD twin** (`text`) must be updated alongside any FAQ copy change.
- **`SEASON_YEAR`** at the top of the event page drives the t-shirt year and the Congress year in
  the What's Included / How it Works copy — one line to bump each season.
- Browser-pane screenshots go blank/stale once a page is scrolled; measure with
  `getBoundingClientRect` via `javascript_tool` instead, and assert `window.innerWidth` after any
  `resize_window`.
