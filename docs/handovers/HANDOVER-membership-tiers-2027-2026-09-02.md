# Handover — 2027 Membership Tiers alignment (2 Sept 2026)

**Status: DEPLOYED + PROD-VERIFIED.** Commits `718b717` and `c2954a4` on `main`;
migration `147_membership_tiers_2027_canon.sql` applied to prod.

Canon: `Shared drives/Stellr/1 Campaigns/Flyers/2027 - Membership Tiers.pdf`.
Scope was **the teacher family only** (Educator / Catalyst / Innovator / Trailblazer).
The School and College ladders were explicitly ruled out of scope and are untouched.

---

## Start here — the three things that are NOT finished

### 1. ⚠️ Mentoring copy and mentoring entitlement now disagree, in prod

This is the one genuine miss of the session. The instruction was "mentoring quantity is
biweekly"; only the **copy** half was done.

| Layer | Says |
|---|---|
| `/membership` waterfall (LIVE) | "Biweekly group mentoring call" — Innovator & Trailblazer |
| `entitlements.tier_benefits` (LIVE) | `cohort_access`, quantity **8**, period `one_off`, validity 365 days |

Biweekly across a school year is roughly 18–20 sessions, not 8. A teacher on Innovator
or Trailblazer will hit the entitlement wall less than halfway through the year while the
website promises fortnightly calls all year.

Not fixed here because the correct number is a judgement with cost attached, and
"biweekly" does not by itself say across what window — a 36-week school year, a campaign
season, or 52 weeks all give different answers.

**Recommended:** 18 (biweekly across a ~36-week school year). Apply with
`update entitlements.tier_benefits set quantity = 18 where tier_code in ('innovator','trailblazer') and kind = 'cohort_access';`
— or change the copy instead, if 8 is the real commercial commitment.

### 2. ⚠️ Trailblazer's flagship student benefit is already free

The flyer sells "student membership upgraded to Pathfinder for 1 year" as the $999
differentiator. Three **active** rules in `tier_grant_rules` already grant Pathfinder for
12 months at no cost:

- `Competition registration → Pathfinder (12mo)` — any participant
- `Student attends event → Pathfinder (1yr)`
- `Premium enrollment → Pathfinder (12mo)`

Migration 147 narrowed the *fan-out* rule (`Educator tier → registered students get
Pathfinder`) to Trailblazer alone as instructed, but that does not touch the three above.

This got **more** visible on 2 Sept: `/competitions` now correctly advertises the free
year of Pathfinder, while `/membership` sells the same year as the Trailblazer benefit —
on two pages a teacher reads back to back. Both statements are accurate to the live rules.
The conflict is in the tier design, not the copy. **Needs a pricing/policy decision.**

### 3. ⚠️ Every paid tier Space is empty — the site now advertises precisely what the app cannot deliver

| Space | Resources |
|---|---|
| Educator Tier Space | 7 (already named to 2027 canon) |
| Catalyst Tier Space | **0** |
| Innovator Tier Space | **0** |
| Trailblazer Tier Space | **0** |

Exactly one paid-tier asset exists anywhere in the catalogue:
`2027 - Mission Handbook - Complete` (`930856fe-dde4-4435-8929-0489b5b8685a`), unattached.
Everything else on those three columns has not been produced.

**This is missing content, not an infrastructure gap.** Space containers are created lazily
by `ensureSpaceContainer` (`lib/container-sync.ts`) the first time an admin attaches a file,
which is the only reason Educator has a container row and the others do not. An admin
uploading to Catalyst just works.

Blast radius of all three items is nil today: `member_memberships` holds **zero** paid
teacher memberships.

---

## What shipped

**One ladder, not two.** The benefit list was written twice — `WATERFALL_ITEMS` in
`app/(public)/membership/tier-data.ts` and `TIER_ITEMS` in
`app/(public)/competitions/page.tsx` — and the copies had drifted from each other and from
the flyer. `/competitions` now derives via `educatorTierHighlights(t)` (one item per
category in flyer order, then fill to 5). **Do not reintroduce a second hand-written tier
list.** Seven tests in `tier-data.test.ts` pin the ladder to the flyer.

**Content**, to the flyer's six categories (`core`, `teacher`, `student`, `live`, `cte`, `ai` —
the old 7th `mem` band is gone; the flyer files the Pathfinder upgrade under Student support):

- free tier now offers **abridged** core material — both surfaces previously promised the
  full RFP and Mission Handbook at no cost
- PD certificates (2/6/10 hrs) and **TEKS** added; neither existed anywhere in the codebase
- brainstorming templates → Catalyst; curated resources → Innovator
- live engagement re-quantified: 90 min / 1–3 calls (Innovator), 3 hrs / 2–6 calls (Trailblazer)
- three tutorial tracks added; four invented items dropped (Scoring Rubric,
  Sub-Contractor Guide, Lesson plans, Judging template) — **confirm these are not real
  assets the flyer merely omitted**
- upgrade steps (`up: true`) are displayed but excluded from the benefit counter, which
  previously overstated what a paid tier adds. 41 lines, 11 upgrades, 30 countable benefits.

**Discounts removed** from teacher tiers — `store`/`academy` are now optional on `Tier`;
the waterfall's discount strip is gone. Display-only: the DB rows in
`098_seed_tier_store_discounts.sql` and the entitlements discount seeds were left intact,
so nothing a teacher is *charged* changed. Revisit if the intent was to remove the perk.

**Migration 147** narrowed the student fan-out to Trailblazer and rewrote the Innovator
and Trailblazer descriptions (Innovator still claimed to be the lowest paid educator tier;
Trailblazer still claimed to be sales-led despite an active Stripe price). Note: **no
component renders `membership_tiers.description`** — this is data hygiene for admin/Studio,
not a user-visible fix.

**`/campaigns` links to `/membership` again** — `lib/campaign-content.ts` carried a comment
saying to restore the link once the page was accurate.

## What was already correct — do not re-derive

- **Prices.** Educator $0 / Catalyst $149 / Innovator $499 / Trailblazer $999, verified
  against the **live** Stripe Prices (all annual, active) and matching `membership_tiers`.
- **Tier names.** `lib/tiers.ts` already had the four in flyer order.
- **No monthly billing for teachers.** `monthly_cost_cents` is NULL for all four and the
  `/membership` toggle is data-driven (`monthlyAvailable`), so it never appears.
- **PD certificates deliberately not built** — David is issuing them manually for now.
  `lib/certificate.ts` has no hours concept at all; building it is a separate piece of work.

## Smaller things left open

- `TIERS_BY_BRACKET.college` in `lib/tiers.ts:49` includes `Catalyst`, so a college student
  may hold a teacher tier. Pre-existing; `lib/membership-rules.ts` already carries a
  "confirm its eligibility surface" TODO.
- `lib/campaign-content.ts:54` reads "Student campaign guide and assessment tools", bundling
  two things the flyer files under different rows (Assessment Tools BASIC is Teacher support).
- "Students can register as members" was dropped from the free tier with the old `mem`
  category. It is true and was a fair selling point; the flyer just does not list it.
- `/educators` and `/grant` were left untouched — a concurrent session was renaming Teacher
  Stipend → Teacher Grant Program. `/educators:198` pairs `GRANT_PD_HOURS` ('10–20') with
  free Catalyst, whose PD certificate is 2 hrs. Different things, but confusing side by side.
- Naming drift vs content ops: flyer says "Campaign Guide" / "Assessment Tools BASIC";
  stored files are "Campaign Planner" / "Judging Pack - BASIC".
- Admin surfaces (`RulesClient`, `PeopleTab`) hold complete hard-coded tier-name lists.
  Names did not change so they are correct, but they are a drift risk if a tier is ever added.
- Trailblazer self-serve checkout has never been exercised end-to-end (no test purchase).

## Working practice worth repeating

A concurrent session held the same working tree throughout. Nothing collided because:
**stage by explicit path, and do not `git checkout -b`** — creating a branch switches it for
every session sharing the checkout, which is how the August collisions happened. Commit on
`main` locally and `git push origin HEAD:main`.
