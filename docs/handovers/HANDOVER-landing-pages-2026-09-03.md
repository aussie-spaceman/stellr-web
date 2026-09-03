# Handover — audience landing pages (`/lp/[slug]`)

Session close-out, 3 Sep 2026. Successor to
`docs/handovers/OUTSTANDING-landing-pages-2026-09-02.md`, which tracked the
twelve setup items and is now almost entirely closed.

**Read this first if you are picking the work up.** Everything below is either a
live defect, something a previous summary implies is done when it is not, or a
decision that has moved since the plan was written.

---

## What is live and verified

Two config-driven landing pages, deployed and confirmed on production:

- `https://www.stellreducation.org/lp/first-robotics-teachers`
- `https://www.stellreducation.org/lp/homeschool-students`

| Piece | State |
|---|---|
| Routes, indexed, self-canonical, in sitemap | Live, verified by curl |
| Derived location map | Live — ten locations, eight states, six running, four planned; 6 solid + 4 dashed pins, 140 outline paths |
| Lead capture → HubSpot | Live and **proven with three real submissions**; `Recent Conversion` reads "Website — Landing Page Enquiry" |
| Auto-redirect to Motion on success | Live, both paths browser-verified |
| Booking reconciliation cron | Live, daily 12:00 UTC, **verified end to end** — first run stamped 2 contacts, second reported `alreadyBooked: 2` |
| GTM: `lp_view`, `lp_cta_click`, `lp_booking_click`, `flyer_download` | Published and confirmed in `gtm.js` |
| GA4 custom dimensions | `lp_audience`, `page_slug`, `location` registered, Event scope |
| `MissionFundingNote` | On both pages (Ad Grants requirement for paid surfaces) |
| Per-audience OG images | Serving, 1200×630 PNG, visually checked |

427 tests, token lint and `check:deploy-ready` all green.

---

## 1. Live defect — fix before spending ad budget

### `Zero locations across zero states` when Sanity is unreachable

`lib/locations.ts` `getMapLocations()` returns `[]` when the Sanity client is
absent or a fetch fails. `countLocations([])` then yields all zeros, and
`fillCounts` renders them faithfully. Measured:

```
map lead      → "Zero locations across zero states — zero running now, zero in planning."
hero eyebrow  → "Design competitions · Zero states"
FAQ answer    → "Zero locations across zero states, on university and museum campuses."
```

The page still returns 200, so nothing alarms. On a paid landing page that copy
is actively worse than showing nothing.

This was never surfaced during the build because the counts were described as
"derived and un-driftable", which is true of *drift* and says nothing about a
fetch failure.

**Suggested fix.** In `components/lp/LandingPage.tsx`, when `counts.total === 0`:
fall back to a static sentence that makes no numeric claim ("We run design
competitions on university and museum campuses across the United States"), drop
the `{{states}}` clause from the hero eyebrow, and skip the
`GlanceAndLocations` map cell entirely. A test in `lib/locations.test.ts`
already covers the empty case, so extend from there rather than starting fresh.

---

## 2. Things a previous summary implies are complete, and are not

### a) OG images do not use the brand typeface

I described them as "generated in code using the design tokens and Space
Grotesk". The tokens are used; **Space Grotesk is not.** `ImageResponse` cannot
resolve a webfont by name — the font binary has to be passed in `fonts: []`, and
`app/(public)/lp/[slug]/opengraph-image.tsx` sets `fontFamily: 'sans-serif'`.
The card renders cleanly but in a generic system sans, so a shared link is
off-brand typographically. Verified by downloading the live PNG.

Fix: read the Space Grotesk woff from disk and pass it to `ImageResponse`. Note
the repo currently loads fonts via CSS, so the binary may need adding.

### b) `app/api/webhooks/motion/route.ts` has never been exercised

It is deployed and reachable, correctly rejects unsigned and badly-signed
requests (both verified `401`) — but **no request with a valid signature has
ever reached it**, and it has no test file. `scripts/test-motion-webhook.ts` was
written to prove it and never run, because the work went the cron route instead.

So the HMAC comparison, the `findEmail` payload walk and the note write are all
unproven. It is also now redundant: the cron closes the same loop without it.

Decide one of: run the test script once and keep it as the path a native Motion
webhook would use, or delete the route, the script and `MOTION_WEBHOOK_SECRET`.
Leaving an unproven, unused, write-capable endpoint on production is the worst
of the three.

### c) `lp_cta_click` will only ever report `location: hero`

`CtaLocation` in `components/lp/LpTracking.tsx` is typed
`'hero' | 'cta_block'`, and a GA4 custom dimension is registered for
`location` — but the reserve block holds the form, not a button, so nothing
emits `cta_block`. The dimension is not wrong, it is just single-valued.

Either drop `cta_block` from the type, or add a secondary CTA somewhere that
justifies it. Harmless as it stands; only worth knowing before someone reads
the dimension and wonders where the other value went.

### d) `docs/PLAN-landing-pages-2026-09-02.md` is stale on one decision

Its decision 2 reads "Two-step booking panel". That was reversed on 3 Sep: the
form now redirects automatically and the panel is the **failure path only**. The
rest of the plan is still accurate. The published artifact
(`claude.ai/code/artifact/e8e79733-e629-4b1c-97c8-fa3703630544`, revision 3)
also still says "two follow-ups remain", which is out of date.

### e) Photo credit is not shown on the hero card

I said "content caption from the config on each card, and one credit line per
photo section". Delivered for the gallery. The **hero** card carries its caption
but no visible credit — the credit is `sr-only` inside `<picture>`. Consistent
with `ResponsivePhoto`'s default, inconsistent with what I said. Decide whether
a hero photo needs a visible credit; the watermark-removal work made visible
credit the norm, so it probably does.

### f) `MOTION_BOOKING_EXCLUDE_EMAILS` was never set

The cron excludes the organiser, `MOTION_CALENDAR_ID` and `CONTACT_EMAIL`
automatically. The argument for this var was staff who get added to booking
invites. Nobody is excluded beyond the automatic three, so if a colleague is
ever added as a guest on a booking event **and** is a HubSpot contact with
`lp_audience` set, they would be stamped. Low likelihood, and the `lp_audience`
guard makes it very unlikely — but the variable exists precisely for it.

### g) Consent is enforced but never stored as data

The checkbox is required client-side (zod) and server-side, and refusing it
returns 400. But no HubSpot property records it — `submitForm()` sends no
`legalConsentOptions`, matching all seven existing forms. So the evidence of
consent is the existence of the submission plus the note, not a field. That is
the house pattern and was a deliberate decision, but "consent recorded" should
not be read as "consent is queryable".

### h) `/lp/homeschool-students` was never checked below 1280px

Responsive QA at 375 / 768 / 1024 / 1440 was run on **robotics only**. The
homeschool page renders two reason cards where robotics renders three, and that
`auto-fit` grid is the one layout that differs between them. It was verified at
1280px (two equal 532px cards on one row) and by the shared component tests, but
never at 375px.

### i) Preview deployments cannot run the cron

`MOTION_CALENDAR_ID` and `MOTION_BOOKING_TITLE` are Production-only, so on a
preview deploy the route answers `200 {skipped: 'Calendar not configured'}`.
Harmless and arguably correct — a preview should not write to the live CRM — but
it means the cron cannot be tested on a preview branch.

---

## 3. Open questions for David

1. **`david.michael.shaw+mark@gmail.com`** — a `homeschool` contact with
   `lp_call_booked` empty. If that enquiry never booked, the funnel is working
   and this is the first genuine entry for the follow-up list. If a call *was*
   booked, the calendar event title probably did not match
   `MOTION_BOOKING_TITLE`.
2. **Studio: venue name.** The Highlands Ranch event's `venue` reads
   "STEM Academy"; the school is STEM School Highlands Ranch. Pre-existing, but
   now publicly visible in the map's accessible location list.
3. **Studio: review a `plannedLocation`.** All four were created by script and
   the fields have never been opened in Studio.

---

## 4. Traps worth carrying forward

- **A dot in a Sanity `_id` makes a document invisible to unauthenticated
  clients.** Four `plannedLocation` docs created as `plannedLocation.<slug>`
  read back perfectly to every authenticated query and were invisible to the
  live site, which rendered "zero in planning" and logged nothing.
  `scripts/backfill-lp-locations.ts` now re-reads with no token after applying
  and fails if the public count does not match.
- **Vercel Hobby rejects sub-daily crons at deployment validation**, producing
  no deployment record — so `vercel ls` shows nothing wrong and the last good
  deploy sits there looking current. An hourly schedule blocked every deploy for
  three hours.
- **A Vercel Secret cannot be read back.** `vercel env pull` substitutes
  `[SENSITIVE]` and there is no `env get`. Generate secrets visibly, then add.
- **`vercel env add <name> preview` prompts for a Git branch after reading the
  value**, so a piped value leaves the prompt at EOF and the command aborts
  having printed help text. Use `--value ... --yes`.
- **`gtm.js` compiles away GTM variable display names.** `vtp_name` is the
  dataLayer key, not the UI name, so the published container cannot tell you
  what a variable is called. Use the variable picker, never typed `{{...}}`.
- **A GA4 event parameter is invisible in reports until registered as a custom
  dimension** (Event scope), and there are only 50 slots.
- **Google Calendar `updatedMin` is capped at ~25 days when `showDeleted` is
  on.** Off, a 365-day window works.
- **Motion has no webhooks and no booking API** (tasks/projects/comments only);
  its Zapier and Make apps expose only new-task and new-comment triggers. Do not
  confuse it with MotionTools (`motiontools.io`), which does have booking
  webhooks and is an unrelated logistics product.
- **Motion booking pages do not support prefill** — `?name=`, `?email=` and its
  own `?e=` are all ignored, tested against the live page.
- **An over-broad calendar title filter is the dangerous failure.**
  `MOTION_BOOKING_TITLE=Stellr` matched 212 of 250 events on the primary work
  calendar. The needle is the booking-link name,
  `Welcome To Stellr Events`, and the `lp_audience` guard is the real backstop.
