# Handover — Campaign registration state & school-year semantics

**Date:** 28 August 2026
**Commit:** `168a1d7` (on `main`, deployed to prod, live-verified)
**Migrations:** none
**Sanity content change:** yes — see §1

---

## 1. What was wrong, and what changed

The admin Events page showed **Registration: Closed** for both Fall 2027 campaigns.
Two independent defects were behind it.

### 1a. Content — the manual toggle was off (fixed in Sanity, no code)

Campaigns do **not** derive registration state from dates. They use the Sanity
`registrationOpen` boolean, and `app/(admin)/admin/competitions/page.tsx` reads it
straight through:

```ts
return event.registrationOpen ? { label: 'Open' } : { label: 'Closed' }
```

Live values found in production:

| Campaign | `registrationOpen` was |
|---|---|
| Space Design Campaign - Fall (`5ee61f20-…`) | `null` — the field had never been touched |
| Environmental Design Campaign - Fall (`b5b4f28c-…`) | `false` — the value `scripts/seed-events.ts` seeds |

Both are falsy → both read Closed. **Set to `true` on both documents.** This was a
content edit, not a deploy: the app client is `useCdn: false` and the page is
`force-dynamic`, so a Sanity edit is live on reload.

> Note the asymmetry with live events, which treat *no dates set* as **open**.
> A campaign nobody has explicitly switched on reads **Closed**.

### 1b. Code — `campaignYear` is the SCHOOL year (`168a1d7`)

David confirmed campaigns are **branded by school year**: "Fall 2027" is the autumn
term of 2026/27 and runs **Aug–Dec 2026**. `getCampaignDates()` had been treating the
stored year as a calendar year, so every derived date for a fall campaign landed a
year late.

The Sanity field description previously said *calendar* year — which is why the data
looks contradictory (`campaignYear: 2027` beside `deadline: 2026-12-11`). **The
description was wrong; the data was right.** It now says school year.

Changes in `168a1d7`:

| File | Change |
|---|---|
| `lib/campaigns.ts` | Fall window derives from `year - 1`; new `calendarYear` field on `CampaignDates`. Label keeps the school year — that is the brand. |
| `lib/hubspot-fields.ts` | `mapEventYear()` no longer adds 1 for fall. It was sending **2028** to HubSpot for a 2027 campaign — inside the 2023–2030 bounds, so it validated silently. |
| `lib/sanity.ts` | Campaign sort `season desc` → `asc`. Within a school year, Fall precedes Spring. |
| `lib/event-portal.ts` | Past-campaign filter compared a school year against `new Date().getFullYear()`, keeping a term that ended 8 months earlier. Now derives the real end date via `getCampaignDates()` and compares against `todayInAppZone()`. |
| `components/campaigns/CampaignDetail.tsx` | "Runs" stat prints `dates.calendarYear`, not the school-year brand. |
| `app/(public)/curriculum/page.tsx` | Fallback campaign + fallback year corrected to school years. |
| `sanity/schemas/event.ts` | Field description + Studio sort order. |
| `lib/campaigns.test.ts` | **New** — school-year windows, the fall regression, the manual off switch. |

---

## 2. Verification actually performed

**Verified live** (curl against `www.stellreducation.org` after the deploy landed):

| Surface | Before | After |
|---|---|---|
| `/curriculum` Fall | "Fall 2027 / Coming soon" | **"Fall 2027 / Open now"** |
| Detail "Runs" | `08-15 – 12-15, 2027` | **`08-15 – 12-15, 2026`** |
| Detail "Deadline" | 11 December 2026 | unchanged, now inside the run window |
| JSON-LD | 2027 dates | **`2026-08-15` → `2026-12-15`** |

- 312 tests pass, `tsc --noEmit` clean, `npm run build` exit 0, `check:deploy-ready` green.
- HubSpot searched for contacts with `event_year = 2028`: **0 results**. No data repair needed.

**NOT verified in a browser:** the admin Events page itself — the page in the original
screenshot. Its data path was verified by running the page's own `getAllCampaigns()`
query and applying `registrationPill()` in a script (both returned **Open**), but the
rendered page was never loaded. Risk is low (the campaign branch is a single ternary on
a boolean that is now `true`), but it is inference, not observation.

---

## 3. Open items

### O1 — `registrationOpen` is display-only; it does not gate registration  ⚠️ material
All three registration routes skip the window gate for campaigns:

- `app/api/register/group/route.ts:117` — `if (eventForGate && !is_campaign)`, commented *"Campaigns are always open (async, free) so they skip the window gate."*
- `app/api/register/individual/route.ts:63` and `app/api/register/group-join/route.ts:93` — call `registrationStatus(openDate, closeDate)`, which returns `'open'` for a campaign because campaigns carry neither date.

**Consequence:** switching a campaign's toggle to Closed makes every surface *say*
Closed while the API keeps accepting registrations. The pill is not a kill switch.
Decide whether that is intended; if not, the three routes need a campaign branch that
consults `registrationOpen`.

### O2 — Every new campaign starts Closed, silently
An unset `registrationOpen` is falsy, so a freshly created campaign reads Closed until
someone explicitly switches it on. This is exactly what happened to the Space campaign.
Options: default it to open when unset, make the Sanity field required with an
`initialValue`, or leave as-is and treat it as a documented editorial step.

### O3 — `campaignStatusFromDates()` compares a UTC date  (`lib/campaigns.ts:54`)
```ts
const today = new Date().toISOString().split('T')[0]
```
`registrationStatus()` in `lib/utils.ts` carries a long comment about this exact
pattern costing sign-ups for live events (it flipped ~30h early at 6PM Mountain) and
was fixed to use `todayInAppZone()`. The campaign sibling was never fixed. Impact is
display-only and bounded to a ~7h window at each season boundary — low, but it is a
known-harmful pattern still in the tree.

### O4 — Admin "Season" column bypasses `seasonLabel()`
`app/(admin)/admin/competitions/page.tsx:153` renders
`[campaign.season, campaign.campaignYear].join(' ')` → lowercase **"fall 2027"**, while
every other surface uses `seasonLabel()` → **"Fall 2027"**. Cosmetic.

### O5 — No Spring 2027 campaign exists in Sanity
Only the two fall documents exist. `/curriculum`'s Spring column therefore runs on the
hard-coded fallback year (2027) and reads "Opens later", which is correct today. **When
a spring campaign is created it must be `campaignYear: 2027`, not 2026** — the schema
description now states this.

### O6 — Two behaviour changes shipped without test coverage
`lib/campaigns.test.ts` covers the date maths, but the `event-portal.ts` past-campaign
filter and the `getAllCampaigns()` sort order changed with no test asserting either.

### O7 — Registration is now open on a campaign that has never taken one
Both campaigns show **0 participants** and have just moved Closed → Open. The group
registration path for a campaign has not been exercised end-to-end since. Given
registration is enrolment-critical, one real submission is worth doing.

---

## 4. Things deliberately not done

- **`campaignYear` was not changed in Sanity.** David chose to fix the code, not the
  data. Both documents remain `2027`. This also means the existing
  `2027-space-design-campaigns` Space name stays consistent — no ripple.
- **The `registrationOpen` default was not changed** (see O2) — flipping it would
  silently open every campaign in the CMS.
