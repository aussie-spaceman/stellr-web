# HANDOVER — Campaign page parity

**Date:** 25 Aug 2026 · **Status:** MERGED to `main` and LIVE, verified
**Commit:** `3b22cad` → merged `052452b`
**Predecessor:** [HANDOVER-event-pricing-2026-08-21.md](./HANDOVER-event-pricing-2026-08-21.md) — read that first; this
extends it to the campaign surface and carries its open items forward.
**Verification:** `npm run audit:event-prices`, `npm run audit:event-slugs`

---

## 1. What shipped

The 21 Aug event-page work stopped at the campaign branch. `/events/[slug]`
short-circuits into `components/campaigns/CampaignDetail.tsx`, which had no
eligibility statement, no What's Included, no FAQ section and **no FAQ schema at
all**. It now has all four, plus two bug fixes.

New: `lib/campaign-content.ts` (copy + `campaignEligibilityCopy()`),
`lib/campaign-content.test.ts`, `components/campaigns/CampaignDetail.test.tsx`.

### Why the event copy could not simply be ported

Most of the event wording is bound to a venue and a single day. Campaigns have
neither, so four of the eight event FAQs were dropped (what to bring, transport,
chaperones at the venue, invoicing) and replaced with campaign ones (deliverable
and submission, time commitment across a term, what happens after judging).

**Three rules differ, and tests assert them so a later "unification" cannot
quietly erase them:**

- **Campaigns are freemium, not free.** Membership IS required; the entry-level
  Educator tier costs $0. The hero's **"Free with membership" is correct copy** —
  softening it to "free to enter" loses the requirement. (I proposed exactly that
  and was corrected; don't repeat it.)
- **Campaigns are entered as a GROUP, never by an individual student**, and the
  group may be registered by a **student manager**, not only a teacher or mentor.
- **No Congress progression on campaign pages.** The Educator tier's competition
  engagement is written judging feedback on an optional submission. There is also
  no venue, travel, meal, t-shirt or chaperone story. `campaign-content.test.ts`
  fails if any of those strings reappear.

### What's Included = the free Educator tier

Taken line-for-line from the 2027 membership flyer
(`Shared drives/Stellr/1 Campaigns/Flyers/2027 - Membership Tiers.pdf`), written
as public copy rather than the internal tier names ("Campaign Guide Teacher
BASIC"). The ladder is **Educator free → Catalyst $149 → Innovator $499 →
Trailblazer $999**, and `membership_tiers` matches the flyer exactly.

The upsell line names the three paid tiers **without prices and without linking
to `/membership`** — that page is known to be out of date and a separate session
owns fixing it. Add the link then. If prices are ever shown, resolve them through
`getTierPriceMap()` rather than hard-coding the flyer figures.

## 2. Two adjacent bugs fixed

- **A switched-off campaign advertised a live "Compete Now →".**
  `campaignStatus()` is documented as the one display resolver and is used by the
  admin console, `/curriculum` and the member portal — but `CampaignDetail` never
  called it, so visitors clicked through to a 403 from the registration API. The
  page now shows a status pill and withdraws the CTA, while a registered member
  keeps their way back in regardless of the window.
- **`app/api/register/individual/route.ts` had no campaign handling.** The URL was
  reachable directly and would have written `type: 'individual'` for a campaign,
  while the member's campaign context and workspace both filter on
  `type: 'campaign'` — accepted, then invisible to whoever registered.

## 3. Traps

- **`CampaignDetail` is written in the V2 token vocabulary** (`bg-midnight`,
  `text-ink`, `text-content-secondary`, `rounded-panel`, `@stellr/web-ui` Button)
  while the event page still uses pre-V2 `brand-*`. **`ds-lint` only catches old
  hex literals and font names, so mixing the two vocabularies passes CI** — there
  is no automated guard. Match the file you are in.
- **`campaignYear` is the SCHOOL year.** Fall 2027 runs Aug–Dec 2026, which is why
  the component prints the calendar year separately.
- Campaign status comes from the manual `registrationOpen` toggle; **unset reads
  Closed.** Live events invert this (no dates = open).

## 4. Open items carried into the next session

Verified against production on 25 Aug — these are current, not stale.

### High

- **`/impact` is live with two contradictory scholarship promises.** A parallel
  session softened one block and shipped it (`547a4ee`), but a second, related
  edit to the `FUNDING_BLOCKS` "Where surplus goes" copy is **still uncommitted in
  the shared working tree**. Live today: one block says "we will do our best to
  cover it — either partially or in full", another still says a student "still
  competes, at no cost to their family". This page is Ad Grants-sensitive. Not my
  change and not mine to commit — but it needs finishing or reverting, and the
  uncommitted half is at risk of being lost or swept into an unrelated commit.
- **North Carolina's Stripe price ID is still dead** four days on
  (`price_1TeztlKUgSKucUJEyhlsAAFq`, not in the live account). The fee is hidden
  **and registration checkout is broken** — the route 503s before any writes.
- **Rhode Island is still live at $0.51** — publicly displayed and chargeable.
- **Resend has no daily quota guard** (`docs/REC-form-spam-hardening.md` §7). One
  ~100/day pool shared by registration confirmations, DocuSign notices and drips,
  with two public forms mailing an attacker-supplied address. First symptom of
  exhaustion is real families silently not receiving registration email.

### Medium

- **`export const revalidate = 3600` on the event page is dead code.** Production
  returns `cache-control: private, no-cache, no-store` with `x-vercel-cache: MISS`
  — the route renders dynamically on every request, so there is no hourly ISR
  window. Consequence: every event page view does a fresh Sanity fetch (the Stripe
  price is still cached 60s via `unstable_cache`). Either remove the line or make
  the route genuinely static; today it misleads anyone reading the file.
- **Uruguay has no price ID**, so it reads "Pricing TBC" while its group form
  still treats a blank ID as free and would confirm registrations collecting
  nothing.
- **Site-wide link contrast** — `text-brand-blue` is 4.16–4.46:1, under WCAG AA.
  Only the event and campaign blocks touched so far use `text-primary-deep`.
- **`text-brand-grey-mid` resolves to `#13183A`** (near-ink, not muted). Pages
  using it for subordinate text render far heavier than intended.

### Low / confirm

- **Are campaigns US-only?** The standard eligibility copy deliberately drops the
  "in the USA" restriction the Space campaign's old Sanity note asserted, since
  Stellr runs a Uruguay event. One line to add back if the restriction is real.
- Campaign (and event) eligibility copy for **Middle School / Both has never
  rendered** — every published event and campaign is High School.
- Texas has read **"Free to enter"** since 21 Aug rather than the "Pricing TBC"
  originally asked for, because it carries an explicit $0 price. Treated as
  intentional; clear the price ID if not.
- Privacy policy still stamped **Last Updated: 17-Aug-2026** though it published
  on 21 Aug.
- The events **listing** page shows no price; Nevada's merged rows still look like
  test data (8 withdrawn registrations, a company named "Bill").
- The membership flyer has a typo: Trailblazer reads "**Studend** membership".

## 5. Optional improvement

Price edits currently reach the public page in **~60 seconds** (the
`unstable_cache` window; there is no page cache in front of it). The cache is
tagged `event-prices`, so a Stripe webhook on `price.updated` calling
`revalidateTag('event-prices')` would make it instant. Not wired up.
