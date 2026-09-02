# Plan — audience landing pages (`/lp/[slug]`)

Source: `~/Downloads/design_handoff_landing_pages` (Claude Design handoff, 2 Sep 2026).
**Revision 2**, 2 Sep 2026 — David's answers folded in.

Standing rule for this build: **the live site's design language and formatting
take precedence over the handoff wherever the two disagree.**

Scope: one config-driven landing page layout plus the first two audience pages —
`/lp/first-robotics-teachers` and `/lp/homeschool-students`. Event-agnostic: no
dates, no single venue, cost stated as varying per event.

---

## 1. Decisions locked

| # | Decision | Consequence |
|---|---|---|
| 1 | **Full site chrome** | Routes live in `app/(public)/lp/[slug]`; inherit `SiteHeader` + `SiteFooter variant="full"`. No new layout file. Handoff's slim footer is dropped. |
| 2 | **Two-step booking panel** | Form card swaps to a "Pick a time to talk" panel on success; lead is stored before anything navigates. |
| 3 | **Data-driven map now** | No raster. New Sanity `plannedLocation` type + `latitude`/`longitude` on `event`; legend counts and lead sentence derive from data. |
| 4 | **Keep flyer Title Case, fix the grammar** | Headlines/kickers verbatim. Homeschool reason 1: `"students to meeting new people"` → `"students to meet new people"`. |
| 5 | **Required consent checkbox** | Matches `ContactForm` / `HostEventForm` / `JoinNetworkForm` / `TeacherGrantForm`; zod-validated. |
| 6 | **Indexed, in the sitemap** | Self-canonical `/lp/<slug>`; both slugs added to `app/sitemap.ts`. |
| 7 | **One shared HubSpot LP form via `captureLead`** | New `landing_page` lead source + one `HUBSPOT_FORM_LANDING_PAGE` GUID; `lp_audience` / `lp_source_page` distinguish pages. |
| 8 | **Sanity `plannedLocation` document type** | The planned sites are Studio content, not a repo constant. |

---

## 2. Where the handoff and the repo disagree — repo wins

The handoff was authored against a design-system prototype whose component API
does not match `@stellr/web-ui`. Every row below is a real mismatch found by
reading the code, not a style preference.

| Handoff specifies | The repo actually has | What ships |
|---|---|---|
| `SiteHeader active="competitions" logoSrc="logo-dark.png"` | `SiteHeader` takes **no props** and is already mounted by `app/(public)/layout.tsx` | Nothing — inherited |
| `SiteFooter variant="slim"` | `variant` prop exists, but `(public)/layout.tsx` hard-wires `full` | `full` (decision 1) |
| `Button size="lg"`, `variant="outline"` | `Button` has **no `size`** prop; variants are `primary` / `secondary` / `outlineWhite` / `energy` / `softBlue` / `softAmber` | `primary` on light grounds, `outlineWhite` on navy. **No `size` prop added** — nothing else on the site has one |
| `Pill theme="space"` | No `Pill` component. `Badge` (pill radius + tint classes) and `InfoPill` (navy translucent) | `Badge` with `bg-space-violet-bg text-space-violet-text` |
| `StepCard`, numbered from array index | `StepCard({ n, title, body })` — exact match | Use as-is with `n={i + 1}` |
| Hero: `radial-gradient(120% 130% at 85% -10%, …)`, star-dot scatter at `top:74px right:150px`, 1080px column | `Hero` = `linear-gradient(180deg, midnight, midnight-deep)` + a violet blur glow, `max-w-7xl`, `py-20`, optional `media` slot | Repo `Hero` with `media`. **No star-dot scatter** — the shared Hero owns the hero treatment and eight other pages depend on it |
| Native HTML validation; errors at 13px in `#B0554D` | Every form uses react-hook-form + zod + `components/forms/FieldError` | rhf + zod + `FieldError` |
| `app/api/lp-submit/route.ts` posting straight to `api.hsforms.com` | `captureLead()` in `lib/hubspot.ts` — form submit + note engagement + append-only activity log + lifecycle intent + dead-letter alert | `app/api/lp-lead/route.ts` calling `captureLead` |
| `lp_form_submit` carrying `audience: <lp audience>` | `lead_submitted` carrying `lead_source` + `audience: 'b2b' \| 'b2c'` — the key `audience` already means something else | `trackLeadSubmitted(...)` for the conversion; three new `lp_*` events. See §7 |
| `legalConsentOptions` with `subscriptionTypeId` | `submitForm()` sends **no** `legalConsentOptions`, and no existing form does | Match existing practice. See §3 item 6 |
| Raw hex throughout | `npm run lint:tokens` gates the build; CLAUDE.md forbids hex in `app/**`, `components/**`, `packages/**` | Token utilities only |
| Content column 1080px | CLAUDE.md agrees (`max-w-content`); older public pages use `container-max` (1280px) | `max-w-content` |
| `next/image` pointed at `assets/*.jpg` (2–3MB originals) | `/public/media/<id>-<width>.{avif,jpg}` from `scripts/derive-photos.ts` + `lib/media-manifest.ts` + `ResponsivePhoto` | Derive pipeline, manifest entries, `ResponsivePhoto` |
| No money→mission statement anywhere | `MissionFundingNote` on nine surfaces — the Ad Grants remediation | **Add `MissionFundingNote variant="general"`.** These are paid-ad destinations, and its absence on paid surfaces was one of three grounds Google rejected the domain on |

Smaller notes: the handoff correctly says **Teacher Grant Program** (not
Stipend), and `/grant` is the live URL. And a native `<details>` cannot be open
on desktop and closed on mobile in pure CSS — see Phase 3.

---

## 3. Inputs received, and what they change

**1 · Motion booking URL — resolved.**
`https://app.usemotion.com/meet/david-m-shaw/welcome` → Vercel
`NEXT_PUBLIC_BOOKING_URL` on all three environments. Public title reads
"Welcome To Stellr Events with David"; the page asks for 15 or 30 minutes, so
the panel copy should not promise "20 minutes". **Copy change:** the form
points, the reassurance line and the confirm body all say 20 minutes — change to
"a short call" or "15–30 minutes" so the page and the calendar agree.

**2 · Motion prefill — tested, not supported. Dropped.**
Loaded the live booking page and clicked through to the details dialog. `?name=`
and `?email=` are ignored (fields stayed empty). Scanning the page's own bundles,
the only query params it reads are `code`, `emailCode`, `error`, `newTrial`, `d`
and `date` — no name or email key exists. Tested `?e=` and `?d=` directly:
also ignored. Conclusion: **the visitor types name and email once more on
Motion.** Nothing to build. Two consequences: the panel body should set that
expectation, and closing the loop back to HubSpot (item 9) matters more, because
email address is now the only join between a submission and a booking.
(`d` / `date` exists as an undocumented param if we ever want to deep-link a
date; it did not preselect one in this flow.)

**3 · HubSpot setup — I run it.**
Verified against the live portal with the local `HUBSPOT_ACCESS_TOKEN`:
`GET /marketing/v3/forms` → 200 and `GET /crm/v3/properties/contacts` → 200, so
the `forms` and `crm.schemas.contacts.write` scopes are both granted. Property
creation and the shared form happen in Phase 4. Names are fixed on first
creation — **HubSpot property names are immutable, and re-creating an archived
name resurrects its old data**, so the list in Phase 4 is final before the script
runs. The resulting GUID goes into Vercel as `HUBSPOT_FORM_LANDING_PAGE`.

**4 · Locations — see §4.** Your list and Sanity disagree; one question left.

**5 · Scholarship claim — resolved.**
Homeschool `why.note` becomes: *"Scholarships are available at every event, and
can cover up to the full cost of a place. Ask for details when you reserve a
position."* The FAQ answer "Scholarships are available at every event" stands as
written on both pages.

**6 · Consent — resolved, nothing needed from you.**
`submitForm()` sends no `legalConsentOptions`, and neither does any existing
form: consent is enforced by a required checkbox and recorded by the submission
itself plus the note and activity-log line. So **`subscriptionTypeId` is not
needed** — which is just as well, since the token lacks
`communication_preferences.read_write` (403 on the definitions endpoint) and no
new scope has to be requested. The landing pages match the house wording:

> I agree to Stellr Education contacting me about this competition. View our
> [privacy policy](/privacy).

with the standard error "You must agree to be contacted". If a true GDPR
subscription record is ever wanted, that is a portal scope change and a separate
piece of work across all seven forms, not a landing-page decision.

### Wanted-before-launch items, now assigned

| # | Item | Owner | Resolution |
|---|---|---|---|
| 7 | GTM tags for `lp_view`, `lp_cta_click`, `lp_booking_click` | **David** | There is no GTM write credential in the repo — a container cannot be published from here. Step-by-step in §7. |
| 8 | Per-audience OG images | **Me** | No artwork needed: generated in code by `app/(public)/lp/[slug]/opengraph-image.tsx` using `ImageResponse`, the design tokens and Space Grotesk. The headline and audience come from the config, so page seven gets one for free. |
| 9 | Motion → HubSpot booking loop | **Split** | I build the receiver at `app/api/webhooks/motion/route.ts` (HMAC-verified, sets `lp_call_booked`, creates a meeting engagement). Motion's side needs either its own webhook feature or a Zapier/Make connection — that is a Motion-account action, so yours. |
| 10 | US state-outline map | **Me** | Confirmed. Simplified US Census cartographic boundary outline (public domain), committed as a single path constant. |
| 11 | Photo credit vs caption | **Me** | Content caption from the config on each card; one "© Stellr Education" credit line per photo section rather than repeated on all four cards. |
| 12 | SEO title casing | **Me** | SEO titles stay sentence case. Title Case exists to match the ad creative in the visible headline; a SERP title has no flyer to match, so the design system's sentence-case rule applies. |

---

## 4. Location data — Sanity does not match the list

Querying the live dataset returns **12 `event` documents**: 10 `live_event` and
2 `campaign` (campaigns are excluded — they have no venue). Against your ten:

| Location | Your list | Sanity | Reconciliation |
|---|---|---|---|
| Las Vegas, NV — UNLV | Live, Space | `nevada-space-design-challenge`, 6 Nov 2026 | ✅ agrees |
| Ashland, NE — SAC Museum | Live, Space | `nebraska-space-design-challenge`, 11 Feb 2027 | ✅ agrees |
| Brookings, SD — SDSU | Live, Space | `south-dakota-space-design-challenge`, 13 Mar 2027 | ✅ agrees |
| Highlands Ranch, CO — STEM School | Live, Space | `colorado-space-design-challenge`, 3 Oct 2026 | ✅ agrees |
| Denver, CO — CSU Spur | Live, Enviro | `colorado-environmental-design-challenge`, 11 Mar 2027 | ✅ agrees |
| Mankato, MN — MSU | Live, Enviro | `minnesota-environmental-design-challenge`, 24 Nov 2026 | ✅ agrees |
| Waco, TX — Baylor | Planned, Space | *absent* | ✅ becomes a `plannedLocation` |
| Ames, IA — Iowa State | Planned, Space | *absent* | ✅ becomes a `plannedLocation` |
| Houston, TX — JSC / Clear Lake | Planned, Space | *absent* | ✅ becomes a `plannedLocation` |
| **Raleigh, NC — St Mary's** | **Planned**, Space | **`north-carolina-space-design-challenge`, dated 6 Feb 2027** | ⚠️ **conflict** — Sanity has it as a dated live event |
| **Austin, TX** | *absent* | **`texas-space-design-competition`, dated 30 Jan 2027** | ⚠️ **not on your list** |
| Providence, RI | *absent* | `rhode-island-space-design-challenge`, **no date** | Excluded by the rule below (undated ⇒ draft) |
| Maldonado, Uruguay | *absent* | `uruguay-environmental-design-challenge`, **no date** | Excluded — undated, and not a US state |
| Wichita, KS | *absent* | *absent* | Dropped. It was on the handoff's raster and in its "eleven / nine states" count |

**Derivation rule** (this is what makes the counts un-driftable):

> A location is **live** when it is a `live_event` with `setting: in_person`, a
> `date`, and a US state. It is **planned** when it is a `plannedLocation`
> document. Undated live events are treated as drafts and excluded; non-US
> locations are excluded from the US map.

Under that rule, and with Sanity as it stands today, the page would read
**eleven locations across eight states — eight running now, three in planning**
(Space 6 / Environmental 2 / Planned 3). Your list implies **ten across eight —
six running now, four in planning** (Space 4 / Environmental 2 / Planned 4). The
gap is entirely Austin and Raleigh.

**Copy that currently hard-codes the old counts and will be interpolated instead:**
`hero.eyebrow` ("Design competitions · Nine states", both pages), `shared.map.lead`
("Eleven locations across nine states — six running now, five in planning"), the
"Where are competitions held?" FAQ answer on both pages, and the robotics
`seo.description` ("at eleven locations across nine states"). All four derive
from `lib/locations.ts` after this, so they cannot disagree with each other again.

---

## 5. Architecture

```
app/(public)/lp/[slug]/page.tsx            route; generateStaticParams + metadata; 404 on miss
app/(public)/lp/[slug]/opengraph-image.tsx code-generated per-audience OG card
app/api/lp-lead/route.ts                   rate-limited zod parse → captureLead()
app/api/webhooks/motion/route.ts           booking confirmation → lp_call_booked
components/lp/LandingPage.tsx              the single layout; renders any config
components/lp/sections/*.tsx               LpHero, GlanceAndLocations, Reasons,
                                           Gallery, Testimonials, ReserveBlock, Faq
components/lp/LeadForm.tsx                 client: rhf + zod, UTM capture, booking panel
components/lp/LocationMap.tsx              SVG map, derived legend, text alternative
content/lp/types.ts                        LandingPageConfig
content/lp/shared.ts                       glance facts, gallery, form shell, eyebrows
content/lp/first-robotics-teachers.ts
content/lp/homeschool-students.ts
content/lp/index.ts                        slug → config registry
lib/locations.ts                           live events + planned sites → pins + counts
sanity/schemas/plannedLocation.ts          new document type
```

Adding an audience page stays: write `content/lp/<slug>.ts`, register it, ship.
No layout work. `LandingPageConfig` field names mirror the handoff's JSON so a
future Sanity `landingPage` type is a loader swap in `content/lp/index.ts` and no
section component changes.

---

## 6. Phases

### Phase 0 — content model (no UI)
Types, shared content, both page configs, the registry.
Shared and therefore un-driftable: the three "At a glance" facts, the map
heading, the four gallery shots, the form shell, the `why` and `faq` eyebrows.
Per-page and deliberately not consolidated: `why.note` (Teacher Grant Program vs
scholarships), testimonials, `defaultRole`, `defaultStudents`.
Copy edits applied here: the grammar fix, the "up to the full cost" wording, and
"20 minutes" → "a short call" wherever the Motion durations contradict it.
Tests: registry ↔ file parity; every slug resolves; optional sections omit cleanly.

### Phase 1 — location data
- `sanity/schemas/plannedLocation.ts`: city, state, latitude, longitude, theme
  (`space` | `environmental`), optional target season, internal notes.
  Registered in `sanity/schemas/index.ts`.
- `latitude` / `longitude` added to `sanity/schemas/event.ts` in the location
  group, hidden for campaigns like their siblings.
- `lib/locations.ts` implementing the §4 derivation rule; coordinates geocoded
  from city + state using the repo's existing `GOOGLE_PLACES_API_KEY`.
- Backfill: coordinates on the live events, and one `plannedLocation` per
  planned site, once §4's one open question is answered.
- Tests: counts derive; dedupe on city+state; campaigns excluded; undated events
  excluded; a missing coordinate degrades to a list entry, never a pin at (0, 0).

### Phase 2 — the map
`components/lp/LocationMap.tsx`. Inline SVG US outline (public-domain Census
boundary) as the base, pins placed from lat/long by an Albers projection, pin
fill from the theme token, legend chips from derived counts. A `<figure>` with a
visually-hidden `<ul>` of every location as the text alternative. Below 768px the
SVG is replaced by a grouped city-by-state list — the raster's illegibility on a
phone is the reason this is being built at all.

### Phase 3 — sections
All composed from `@stellr/web-ui`; no new primitives.
- **LpHero** — repo `Hero` with `media` set to a framed `ResponsivePhoto` card
  (white-alpha panel on navy, 4/3 clip, caption beneath), `Badge` space chip +
  eyebrow row, `Button` primary → `#reserve` and `outlineWhite` → `#faq`.
- **GlanceAndLocations** (`id="where"`) — one white panel on `bg-surface`, grid
  `0.42fr 1fr`; three value-first facts left, `LocationMap` right; `border-left`
  becomes `border-top` when it stacks. Fact 3's gloss carries a newline —
  `white-space: pre-line`.
- **Reasons** (`id="why"`) — `StepCard` grid that does not assume a count
  (3 on robotics, 2 on homeschool), then `why.note` as a voice quote block with
  the `✦` marked `aria-hidden`.
- **Gallery** — 4 framed cards; 2-up on tablet; scroll-snap row below 768px.
  None of the four may be a hero image. One credit line per section.
- **Testimonials** — two voice quote blocks, verbatim from the site.
- **ReserveBlock** (`id="reserve"`) — navy CTA block at `rounded-cta`; gold-star
  bullets and the call note left, the `LeadForm` card right.
- **Faq** (`id="faq"`) — native `<details>`, eight items, **rendered `open` on
  the server** so every answer is in the HTML, with a small client effect that
  closes them below 768px (a media query cannot toggle `open`). Emits FAQPage
  JSON-LD via `lib/structured-data.ts`.
- **MissionFundingNote** `variant="general"` above the footer.

### Phase 4 — form, API, HubSpot
- `components/lp/LeadForm.tsx`: rhf + zod; `name`, `email`, `role`, `students`
  (optional, min 1), `consent` (required, §3 item 6 wording). UTM params read on
  mount and persisted to `sessionStorage` so they survive an anchor click, with
  `document.referrer` as the `utm_source` fallback. 16px inputs (stops iOS
  zoom-on-focus). Submit disables at a stable width. On success the card swaps to
  the booking panel: focus moves to the new heading, `aria-live="polite"`, short
  ease-out fade. On failure it **still** shows the panel, with an error line and
  `hello@stellreducation.org` — a lost lead is the only unrecoverable failure here.
- `app/api/lp-lead/route.ts`: `rateLimitGuard(req, 'lp-lead', { limit: 5, windowMs: HOUR_MS })`,
  zod parse, `captureLead({ source: 'landing_page', … })` with `context.hutk`
  from `readHubspotCookie(req)`. Returns `{ ok, bookingUrl }`. Blank fields are
  filtered before the payload is built — HubSpot writes empty strings over
  existing values. A 400 on `email` surfaces as a field-level message.
- `lib/hubspot-fields.ts`: `landing_page` added to `LEAD_SOURCES`,
  `FORM_ENV_VARS` (`HUBSPOT_FORM_LANDING_PAGE`) and `LEAD_SOURCE_LIFECYCLE`
  (`lead` — they are asking for a call, not subscribing). New `HS` entries,
  **final before the script runs**: `stellr_role`, `expected_student_count`,
  `lp_audience`, `lp_source_page`, `lp_program_interest`, `lp_call_booked`, and
  `lp_utm_source` / `_medium` / `_campaign` / `_content` / `_term`.
  `grant_expected_students` already exists and is grant-scoped;
  `expected_student_count` is deliberately separate.
- `scripts/hubspot-setup.ts` extended with those properties and the shared form;
  run against portal 24379847; GUID added to Vercel.
- `app/api/webhooks/motion/route.ts` — the booking-confirmation receiver.

### Phase 5 — route, SEO, tests
`generateStaticParams` over the registry; `generateMetadata` from `config.seo`
with `alternates.canonical`; `notFound()` on an unknown slug; per-audience
`opengraph-image.tsx`. Both slugs added to `app/sitemap.ts` (monthly, 0.7).
Tests: registry, `lib/locations.ts` derivation, LeadForm validation and submit
path, the API route against a mocked HubSpot, sitemap contains both slugs.

### Phase 6 — responsive and accessibility QA
375 / 768 / 1024 / 1440, **asserting `window.innerWidth` at each** — the browser
pane silently stays around 685px after a resize. Layout verified with
`getBoundingClientRect`, not screenshots, which go stale once the page scrolls.
Mobile is the primary QA target for the form. Focus rings on every control;
`aria-labelledby` on every `<section>`; `text-primary-deep` for links rather than
`text-brand-blue`, which fails AA at body size; never `text-brand-grey-mid` for
muted text.

### Phase 7 — ship
`npm run build:tokens && npm run lint:tokens && npm test && npm run check:deploy-ready`,
then env vars in Vercel, then commit **by explicit path** — the working tree is
shared with concurrent sessions. Prod verification: submit a real lead and
confirm the HubSpot contact, the note engagement and the activity-log line;
confirm the booking panel and the "Choose a time" link; confirm all four
dataLayer events in Tag Assistant.

---

## 7. Analytics

`lib/analytics.ts` already owns the conversion vocabulary, and its `audience` key
means `b2b` / `b2c` — not the landing page's audience. So:

- The conversion stays `lead_submitted` via `trackLeadSubmitted`, with two new
  analytics sources — `landing_page_teacher` (b2b) and `landing_page_family`
  (b2c) — mapping onto the **one** HubSpot `landing_page` source. That keeps ad
  tags correctly scoped: LinkedIn should not fire on a homeschool parent.
- `detail` carries `lp_audience` and `page_slug`, both non-PII.
- Three new events: `lp_view` (via `TrackEvent`), `lp_cta_click` with
  `location: 'hero' | 'cta_block'`, and `lp_booking_click` on "Choose a time".
  The last is the only signal between "submitted" and "booked" — which, with no
  Motion prefill, is the only thing making the mandatory call measurable at all.

**GTM tags must be built by hand — item 7, David.** For each of the three
events, in container `GTM-WXBRWSH`:

1. Triggers → New → **Custom Event**, Event name exactly `lp_view` (then
   `lp_cta_click`, then `lp_booking_click`). No condition beyond "All Custom
   Events" unless you want to split by `location`.
2. Tags → New → **Google Analytics: GA4 Event**, Measurement ID
   `G-4JQ0EXZ7KF`, Event Name the same string.
3. Event parameters: `lp_audience` → `{{DLV - lp_audience}}`, `page_slug` →
   `{{DLV - page_slug}}`, and for `lp_cta_click` also `location` →
   `{{DLV - location}}`. Create each Data Layer Variable if it does not exist.
4. **Do not gate these on the `CE — consent_granted` trigger.** It fires only on
   the banner click and never on a stored-decision replay, so a tag gated on it
   alone misses every returning visitor.
5. Preview, click each CTA, confirm in Tag Assistant's Firing Triggers panel,
   then Submit and Publish. Note `gtm.js` caches roughly 15 minutes after publish.

`flyer_download` shipped in September with no tag in the published container and
every download since has been untracked. Same failure mode — hence the detail.

---

## 8. Deferred, deliberately

- The Sanity `landingPage` document type (a loader swap for when marketing needs
  to edit copy without a deploy).
- A true GDPR subscription-consent record via `legalConsentOptions` — needs a new
  portal scope and would change all seven forms, not just these two.
- Deep-linking a date into Motion via its undocumented `d` / `date` param.

---

## 9. What is still needed from David

### Blocking — one item

1. **Austin and Raleigh: live or not?** Sanity has `texas-space-design-competition`
   (Austin, 30 Jan 2027) and `north-carolina-space-design-challenge` (Raleigh,
   6 Feb 2027) as dated live events, but your list omits Austin entirely and puts
   Raleigh in the planned column. Four sub-answers:
   - Is the Austin event real and on the map? (If it is, it is a ninth state and
     the copy reads nine, not eight.)
   - Is Raleigh live (Sanity) or planned (your list)? If planned, its Sanity
     document needs its date cleared or the document retiring, because the
     derivation rule keys "live" off having a date.
   - Should Providence RI stay excluded? It is an undated live event, and it
     still carries the $0.51 test price flagged in the August pricing work.
   - Should Maldonado, Uruguay appear anywhere? It is excluded from a US map by
     definition, but "nine states" copy on a page that has an international event
     may be worth rethinking separately.

   Everything else in Phase 1 can be built and tested before this lands — only
   the backfill and the four interpolated copy strings wait on it.

### Approvals, not work — reply "fine" and they ship as written

2. **Consent wording:** "I agree to Stellr Education contacting me about this
   competition. View our privacy policy." (matches the other six forms)
3. **Call duration:** the pages currently promise "a 20-minute call"; Motion
   offers 15 or 30. Proposing "a short call to answer your questions" in the
   bullet and "Fifteen or thirty minutes with the person who runs the
   competitions" in the confirm panel.
4. **Scholarship wording:** "Scholarships are available at every event, and can
   cover up to the full cost of a place."

### Yours, and not blocking the build

5. **GTM tags** — three events, steps in §7.
6. **The Motion side of the booking loop** — once the receiver route is deployed
   I will hand you its URL and secret; connecting it is a Motion-account action
   (its own webhook feature, or Zapier/Make). Without it the funnel stops at
   "submitted".
