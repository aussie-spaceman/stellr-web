# Workshops & Cohorts — Access Management · Design Handoff

**For:** Claude Design — to improve how members get, buy, and manage access to **coaching workshops** and **mentoring cohorts** across the platform.
**From:** engineering. The system below is **fully built and building clean** (backend + APIs + a first-pass UI). This handoff describes the model, the flows, the screens that exist today, and the **UX opportunities** to redesign. Treat the current UI as a functional baseline, not a target.
**Companion doc:** `docs/WORKSHOP-COHORT-ACCESS-PLAN.md` (the engineering plan + file map).

---

## 1. What this feature is

Members gain access to two kinds of paid learning containers:

- **Mentoring cohort** — ongoing small-group program led by a mentor (multi-session).
- **Coaching workshop** — focused coaching container led by a coach (often shorter).

There are **two ways in**, and the design must make both legible:

1. **Granted** — access is *earned/included*: free with a membership tier, a fixed number of credits included with a tier each year, or a quantity of credits earned by participating in an event/competition.
2. **Purchased** — access is *bought*: a one-off payment for a single container, or a pack of credits to spend later.

**Hard constraints that shape the UX:**
- Members can be **any age bracket** (minors included). Minors may need a signed participation agreement before a seat opens (see §6, gate).
- **Pricing starts flat** — one price for any cohort, another for any workshop — but **will evolve to per-container variable pricing**. Designs should not hard-code "all workshops cost $X" language; treat price as a per-container value that today happens to share a default.

---

## 2. Core vocabulary (please keep consistent platform-wide)

These terms now exist in code and should anchor the UI language:

| Term | Meaning | Notes for design |
|---|---|---|
| **Credit wallet** | A member's balance of spendable credits | Two independent balances: **cohort credits** and **workshop credits**. 1 credit = 1 enrollment. |
| **Cohort credit / Workshop credit** | The two credit types | Kept separate so they can be priced separately. Don't merge them visually into one number. |
| **Allowance** | Credits included annually with a tier | Roll over (never expire). Source of "your membership includes N". |
| **Top-up** | Credits the member buys in a pack | Same wallet, bought via Stripe. |
| **Grant** | Credits handed out by a rule (event/tier) | e.g. "attend an event → 2 workshop credits". |
| **Access kind** | How *this* member would get into *this* container | One of: **free** (with membership), **credit** (spend 1), **paid** (one-off). Already color-coded in code. |
| **Container** | A cohort or workshop (same underlying entity) | Both are rows of one table with a `container_type`. Useful: the two products can share patterns. |
| **Open / discoverable** | Container is self-registerable | Closed containers are invite/admin-only and shouldn't appear in Discover. |
| **Gate** | A pre-condition before a seat opens | Today: minor participation-agreement (report-only). Future: payment/DocuSign. |

---

## 3. Data the UI has to work with (design-relevant fields only)

**Per container (cohort or workshop):**
- identity: `name`, `theme` (`space` = violet / `enviro` = green tile), `blurb`, coach/mentor name, `plannedSessions`, `startDate`, `timezone`
- access config: `isOpen`, `freeForTierIds[]`, `oneOffPriceCents`, `creditCost` (usually 1), member count
- per-member resolved **access**: `{ kind: free|credit|paid, priceCents, creditCost, canUseCredit, enrolled }`

**Per member:**
- two balances: `{ remaining, used, total }` for cohort credits and workshop credits
- membership tier(s) and what they include (free-mentoring toggle, annual grant counts)
- age bracket / minor status (drives the gate)

**Per tier (admin):**
- monthly price (read live from Stripe), `includes_free_mentoring`, `mentoring_credits_grant` (cohort/yr), `workshop_credits_grant` (workshop/yr)

**Grant rules (admin):** "when `<trigger>` [matching conditions], grant `<tier | N credits of a type>` to `<self | registered students>`." Triggers include signup, event attendance, event award, competition registration, tier purchase, graduation.

---

## 4. Surfaces that exist today (the baseline to improve)

### Member
1. **Workshops landing** — `/community/workshops`
   - Dual-balance **wallet widget** (workshop credits + cohort credits as two cards), list of the member's active workshops, "Find a workshop" CTA, completed list.
   - *Mirrors* the mentoring landing `/community/mentoring` (which has its own credit footnote, not the dual wallet).
2. **Discover** — `/community/workshops/discover` (and `/community/mentoring/discover`)
   - Grid of open containers. Each card: theme tile, name, coach, start, sessions, blurb, **access label** (free / N credits / $ one-off), Register button.
   - **Register modal**: pick pay method (use 1 credit vs pay one-off), or "included with membership". Credit path enrolls instantly; paid path → Stripe Checkout.
   - **Top-up modal**: quantity stepper, live total, → Stripe.
3. **Container detail** — `/community/workshops/[id]` (workshops) / `/community/mentoring/[id]` (cohorts; richer "space" with chat/resources/actions)
   - Workshop detail today is lean: header, upcoming/past sessions, participant roster, or a "register" prompt if not enrolled.

### Admin
4. **Workshops console** — `/admin/community/workshops`
   - Table (name, coach, members, price, credits, open/closed), create/edit modal, archive/delete, **flat pricing-defaults editor** (workshop/cohort price + per-credit prices).
5. **Cohorts console** — `/admin/community/cohorts` (+ a `Membership & access` tab)
   - Cohort list/stats; the Membership & access tab edits per-tier **cohort credits/yr** and **workshop credits/yr** + free-mentoring toggle, and per-cohort access.
6. **Grant rules** — `/admin/membership/rules` (Membership Studio)
   - Rule list + editor; the editor now toggles **Grant: a tier / wallet credits**, and for credits picks type + quantity.

### Entry points
- Member sidebar now has **Mentoring**, **Workshops**, **Coaching** (legacy 1:1) as separate Academy items.
- Admin sidebar Academy has **Mentoring**, **Workshops**, **Sessions**, **Gates**.

---

## 5. The journeys to design around

**A. Earned with my tier (granted, included):**
Member buys/holds a tier → tier includes free-mentoring and/or N cohort + N workshop credits/yr (allowance, rolls over) → credits appear in wallet → member spends them in Discover. *Design need: make "what my membership includes" and "what I've earned" visible and motivating, not buried in a footnote.*

**B. Earned by doing (granted, event):**
Member registers for / attends an event → a grant rule drops N credits into the wallet → member is notified and can spend them. *Design need: surface the moment of earning ("You earned 2 workshop credits") and route them to spend it.*

**C. Bought a seat (purchase, one-off):**
Member opens Discover → picks a container → "Pay $X one-off" → Stripe → returns enrolled. *Design need: clean checkout hand-off + return state.*

**D. Bought credits (purchase, top-up):**
Member buys a credit pack → wallet increments → spends later. *Design need: connect "buy credits" with "what can I spend them on".*

**E. Admin sells/grants:**
Admin creates a sellable workshop (price/credit cost/free-for-tiers), sets per-tier annual grants, and authors event→credit rules. *Design need: a coherent admin mental model spanning containers + tiers + rules + pricing, which today is spread across three consoles.*

---

## 6. States & edge cases the design must cover

- **Access kind per card**: free (membership) / credit (has balance) / credit-but-empty / paid only / *no way in* (no credits + no one-off → upsell to upgrade tier).
- **Wallet zero / low** — encourage top-up or tier upgrade.
- **Already enrolled** — Discover hides it; detail shows the space.
- **Closed / archived container** — not discoverable; archived detail is a locked/read-only state.
- **Minor gate** — a minor without a participation agreement on file *would be blocked* (currently **report-only**; will become enforced). Needs a clear "signature required before you can join" state and a path to sign. Error surfaced today as a flat message; deserves a real flow.
- **Post-Stripe return** — success/cancel landing states (`?joined=1`, `?topup=1`).
- **Refund/cancellation** — if a container is cancelled, spent credits return to the wallet (or a one-off becomes account credit). The wallet should explain these movements (ledger/history is currently invisible to members).

---

## 7. Opportunities to improve (the brief)

These are where design can lift the platform, not just restyle:

1. **One coherent "Wallet" concept.** Today balances surface differently on the workshops landing (two cards) vs the mentoring landing (a text footnote) vs Discover (a pill). Design a single, reusable **Academy wallet** component used everywhere, showing both balances, what they unlock, and how to get more (earn vs buy). Include a **history/ledger** view (granted / bought / spent / refunded) — the data exists; there's no member-facing view.

2. **Make "earning" visible.** Granted credits (tier allowance, event rewards) currently appear silently in a number. Design the **moment of earning** (notification/toast/inbox) and a "you've got N credits to spend" nudge that routes into Discover.

3. **Unify Mentoring + Workshops experience.** They share a model and patterns but are separate sections with divergent UI. Consider a shared **Academy access** pattern (cards, access labels, register modal, wallet) parameterized by product, so cohorts and workshops feel like one system. Resolve the **Coaching vs Workshops** sidebar split (legacy 1:1 "Coaching" sits next to new group "Workshops" — confusing).

4. **Clarify "how do I get in" on every card.** The access label is good; push further — show free/credit/paid *and* the cheapest path the member already has, plus a clear upsell when they have no way in ("Upgrade to X to join free").

5. **A single admin mental model.** Selling/granting access spans three consoles (Workshops/Cohorts containers, Membership&access tier grants, Membership Studio rules) + a pricing editor. Design an **"Access & monetization" admin hub** that connects container pricing ↔ tier inclusions ↔ earn rules so an admin can answer "how does a member get into this?" in one place.

6. **Variable-pricing-ready.** Today price is flat-by-default but stored per container. Design pricing displays/editors that already assume **per-container prices** (and leave room for future variants like per-session or tiered) so nothing breaks when flat → variable.

7. **Minor / agreement flow.** The gate is built but report-only with a flat error. Design the real **"signature required" path** (who signs, where, what unlocks after) for minors joining a workshop/cohort, reusing the existing participation-agreement pattern.

8. **Cross-surface consistency.** Access purchase here is separate from the **Store** (physical goods) and **event registration** payment. Decide and design how an "access purchase" reads vs a store purchase vs an event fee, so billing/history feel like one system to the member.

---

## 8. Guardrails (what design should preserve)

- **Two separate balances** (cohort vs workshop) — don't merge; they price independently.
- **Three access kinds** (free/credit/paid) and the **earn-vs-buy** distinction are core; keep them explicit.
- **Container = cohort or workshop**: lean into shared patterns, but the two products keep distinct names/sections.
- **Pricing is per-container data**, shown flat today — never present it as a global constant.
- **Gates are report-only until enforced** — design the enforced state, but it won't deny until ops flip the flag.

---

### Quick file pointers (if design wants to see current treatments)
- Member: `app/(member)/community/workshops/*`, `components/community/workshops/*`, `components/community/mentoring/DiscoverGrid.tsx`, `TopUpCredits.tsx`
- Admin: `app/(admin)/admin/community/workshops/page.tsx`, `components/admin/workshops/WorkshopsAdmin.tsx`, `components/admin/mentoring/MembershipAccess.tsx`, `components/admin/membership/RulesClient.tsx`
- Model/logic: `lib/credits.ts` (wallet), `lib/workshops.ts`, `lib/mentoring.ts`, `lib/membership-grants.ts` (grant rules), `lib/pricing.ts`, `lib/access-gates.ts` (gate)
