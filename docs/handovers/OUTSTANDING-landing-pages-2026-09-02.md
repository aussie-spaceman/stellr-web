# Outstanding items — audience landing pages

Everything in the build is shipped and live. `main` is deployed; both pages are
verified on production with correct derived counts.

- `https://www.stellreducation.org/lp/first-robotics-teachers`
- `https://www.stellreducation.org/lp/homeschool-students`

Eight items remain. **Items 1–5 are on the landing pages; 6–8 are unrelated
things this session surfaced.** Every command runs from
`~/Documents/GitHub/stellr-web` — `npx vercel` fails anywhere else, because
`.vercel/project.json` is what maps the folder to the project.

| # | Item | Effort | Blocks what |
|---|---|---|---|
| 1 | ~~Two Preview variables~~ | **done** | — |
| 2 | ~~Rotate the webhook secret~~ | **done** | — |
| 3 | Three GTM tags | ~20 min | All landing-page funnel reporting |
| 4 | Close the booking loop — **built**, 3 setup steps | ~10 min | Knowing who actually booked |
| 5 | ~~Submit the live form once~~ | **done** | — |
| 6 | Fix a venue name in Studio | 2 min | Nothing — copy accuracy |
| 7 | Open a plannedLocation in Studio | 2 min | Nothing — a look-over |
| 8 | `flyer_download` has no GTM tag | ~5 min | Flyer download reporting (pre-existing) |

---

## 1. Two Preview environment variables — DONE

Added 2 Sep 2026. Preview now matches Production:
`NEXT_PUBLIC_BOOKING_URL` (Config) and `HUBSPOT_FORM_LANDING_PAGE` (Secret).

**The `printf | vercel env add` pattern does not work for `preview`.** Adding a
Preview variable prompts for a Git branch *after* reading the value, so the
piped stdin is consumed by the value and the branch prompt hits EOF and aborts —
printing the help text and adding nothing. Use `--value` with `--yes` instead,
which takes the default empty branch (meaning all preview branches):

```bash
npx vercel env add NEXT_PUBLIC_BOOKING_URL preview --value 'https://app.usemotion.com/meet/david-m-shaw/welcome' --no-sensitive --yes
```

```bash
npx vercel env add HUBSPOT_FORM_LANDING_PAGE preview --value '74b755b6-d823-4073-90c4-975d523a4612' --sensitive --yes
```

`--no-sensitive` stores as Config, `--sensitive` as Secret. The CLI infers this
correctly from a `NEXT_PUBLIC_` prefix, but with `--yes` in play it is worth
being explicit — a Secret cannot be read back afterwards to check.

For `production` there is no branch prompt, so the `printf |` form is fine
there. `--value` works for both and is the safer habit.

**Correcting earlier advice in this handover.** An earlier revision said the form
GUID belonged on Production only, reasoning that a GUID on Preview would let
preview deployments write real contacts into the live portal. That was wrong on
both counts, checked against the project on 2 Sep 2026:

- Six of the seven existing `HUBSPOT_FORM_*` variables **are** on Preview. Only
  `HUBSPOT_FORM_TEACHER_GRANT` is Production-only, and it is the newest.
- `HUBSPOT_ACCESS_TOKEN` is on Preview **and** Production. So a preview
  deployment already writes real contacts to the live portal through the
  contacts-API fallback path, with or without a form GUID.

Withholding the GUID from Preview therefore prevented no pollution. It only made
a preview submission land without conversion attribution and behave differently
from production — the opposite of what a preview is for.

The earlier reading came from the `vercel env ls production` environments
column, which shows only the queried environment's scope. Vercel stores a
per-environment value as a separate entry under the same name, so a variable set
for both appears once in each listing. Query the environment you care about.

---

## 2. Rotate `MOTION_WEBHOOK_SECRET` — DONE

Rotated 2 Sep 2026 to a value recorded outside Vercel. Kept here for the
mechanism, which applies to any Secret-type variable:

A Vercel Secret cannot be read back — `vercel env pull` substitutes
`[SENSITIVE]` and the CLI has no `env get`. Piping `openssl` straight into
`env add` means the value is gone the moment the command returns. Generate it
where you can see it first:

```bash
openssl rand -hex 32 | tee /tmp/motion-secret
```

Record it, then add and clean up:

```bash
printf '%s' "$(cat /tmp/motion-secret)" | npx vercel env add MOTION_WEBHOOK_SECRET production && rm /tmp/motion-secret
```

To rotate, `npx vercel env rm MOTION_WEBHOOK_SECRET production` first, then
repeat, then `npx vercel redeploy --prod` and update the signing side to match —
the webhook rejects anything signed with the old secret.

Use `printf`, never `echo` or a paste into the interactive prompt: a trailing
newline becomes part of the secret and the HMAC then never matches.

---

## 3. Three GTM tags in `GTM-WXBRWSH`

**What is already fine — do not touch it.** Audited the published container on
2 Sep 2026 by reading `gtm.js` directly:

- `lead_submitted` already has a tag, and **no predicate whitelists particular
  `lead_source` values**. So the landing-page conversions flow into GA4 on their
  own, carrying `lead_source: landing_page_teacher` / `landing_page_family`.
- There is an `audience == "b2b"` predicate gating a tag (LinkedIn). The teacher
  page reports `b2b` and the homeschool page `b2c`, so the teacher page fires it
  and the family page correctly does not. Nothing to change.

**What is missing:** `lp_view`, `lp_cta_click` and `lp_booking_click` each return
zero occurrences in the published container — no triggers, no tags. The
`lp_audience` and `page_slug` data-layer variables do not exist either.

### 3a. Three Data Layer Variables

Variables → New → **Data Layer Variable**, Data Layer Version 2, no default:

| Name it | Variable Name |
|---|---|
| `DLV - lp_audience` | `lp_audience` |
| `DLV - page_slug` | `page_slug` |
| `DLV - location` | `location` |

### 3b. Three triggers

Triggers → New → **Custom Event**, "All Custom Events", event name typed exactly
and with no regex box ticked:

- `lp_view`
- `lp_cta_click`
- `lp_booking_click`

### 3c. Three tags

Tags → New → **Google Analytics: GA4 Event** for each:

- Measurement ID `G-4JQ0EXZ7KF`
- Event Name: the same string as its trigger
- Event Parameters: `lp_audience` → `{{DLV - lp_audience}}`, and
  `page_slug` → `{{DLV - page_slug}}`
- On `lp_cta_click` only, add `location` → `{{DLV - location}}`
- Triggering: its matching trigger from 3b

**Do not add the `CE — consent_granted` trigger to any of these.** It fires only
on the banner click, never on a stored-decision replay, so a tag gated on it
alone misses every returning visitor. Consent Mode already handles the gating for
analytics events.

### 3d. Verify before publishing

1. Preview → `https://www.stellreducation.org/lp/first-robotics-teachers`
2. On load: `lp_view` fires, carrying both parameters.
3. Click "Reserve a spot" in the hero: `lp_cta_click` with `location: hero`.
4. Submit the form, then click "Choose a time": `lead_submitted` then
   `lp_booking_click`.
5. Open each tag's **Firing Triggers** panel in Tag Assistant — it settles
   trigger-versus-consent in one click, which is the thing that has previously
   cost hours of guessing.
6. Submit → Publish. `gtm.js` caches about fifteen minutes after a publish, so
   do not judge the live site immediately.

### 3e. Confirm from the command line afterwards

```bash
curl -s "https://www.googletagmanager.com/gtm.js?id=GTM-WXBRWSH" | grep -o -e lp_view -e lp_cta_click -e lp_booking_click | sort | uniq -c
```

Three non-zero rows. This reads the published container, so it is the real
answer rather than what the UI shows as saved.

---

## 4. Close the booking loop

**Priority raised.** Since the form now redirects automatically,
`lp_booking_click` fires on every stored submission and says nothing about
whether anyone booked. Without this, the funnel reads "submitted" and stops.

### First: Motion cannot do this natively. Checked 2 Sep 2026

An earlier revision said to "check Motion's settings for a native webhook
first". That is now answered definitively — it has none:

- **Motion's API has no webhooks and no event subscriptions.** Its endpoints
  cover comments, custom fields, projects, recurring tasks, schedules,
  statuses, tasks, users and workspaces. There is nothing for booking links,
  meetings or calendar events.
- **Zapier and Make expose only two Motion triggers**: new task and new
  comment. No booking trigger exists.
- Do not be misled by **MotionTools** (`motiontools.io`), which does document
  booking webhooks. It is an unrelated logistics product, not `usemotion.com`.

So the signal has to come from **the calendar Motion writes the booking into** —
Google Calendar, on Stellr's Workspace. Two ways to read it.

---

### Prove the receiver works first — either way

Before wiring anything, confirm the endpoint and your secret agree. Use the
value you recorded when rotating it; a Vercel Secret cannot be read back.

```bash
MOTION_WEBHOOK_SECRET='<the value you recorded>' npx tsx scripts/test-motion-webhook.ts you@stellreducation.org --prod
```

It prints the exact body and signature it sent — which is what a Zapier Code
step has to reproduce byte for byte — and explains whatever status comes back.

- `200` with `matched: true` — working; that contact was stamped.
- `200` with `matched: false` — working, but no such contact in HubSpot. Expected
  for an address that has never submitted the form.
- `401` — the secret here does not match the deployment, or the body changed
  after signing.
- `503` — the secret is not set on the deployment.

Verified already: an unsigned POST and a POST with a junk signature both return
`401`, so the endpoint is not open.

---

### Built: `app/api/cron/motion-bookings` — three things left for you

The cron is written, tested and deployed. It reads the calendar Motion writes
bookings onto, and for any attendee that is **already** a HubSpot contact it
sets `LP Call Booked` and writes a timeline note. It runs at 15 past every hour,
reconciling the last 72 hours, so a booking is picked up within the hour and a
missed run self-heals on the next one.

It will do nothing at all until the three steps below are done — deliberately:
it answers `200` with a `skipped` reason rather than alarming hourly about
something that is simply not wired yet.

#### Step 1 — share the calendar with the service account

Find which calendar a Motion booking actually lands on (book a slot against
yourself if you are not sure), then in Google Calendar:

**Settings for that calendar → Share with specific people → Add people** →

```
stellr-sheets@stellr-498516.iam.gserviceaccount.com
```

Permission: **See all event details**. Not "Make changes" — the job only reads.

Sharing directly is what avoids the Workspace admin console entirely. (The
alternative is `GOOGLE_CALENDAR_IMPERSONATE`, which needs `calendar.readonly`
authorised for this service account's client ID under domain-wide delegation.
Only worth it if you would rather not share the calendar.)

#### Step 2 — three Vercel variables

`MOTION_CALENDAR_ID` is the calendar's ID from the same settings page — usually
just the owning mailbox address.

```bash
npx vercel env add MOTION_CALENDAR_ID production --value '<the calendar id>' --sensitive --yes
```

```bash
npx vercel env add MOTION_BOOKING_TITLE production --value 'Stellr' --sensitive --yes
```

`MOTION_BOOKING_TITLE` is matched as a case-insensitive substring of the event
title, and it matters: the calendar holds your whole working day, and without it
a dentist appointment would stamp "booked an intro call" on whoever was on it.
Check the real title first — if Motion names the event something without
"Stellr" in it, use whatever it actually says.

Optional, for any Stellr address that gets added to these invites. The
organiser, `MOTION_CALENDAR_ID` and `CONTACT_EMAIL` are already excluded:

```bash
npx vercel env add MOTION_BOOKING_EXCLUDE_EMAILS production --value 'someone@stellreducation.org' --sensitive --yes
```

Then redeploy so the cron picks them up:

```bash
npx vercel redeploy --prod
```

#### Step 3 — run it once by hand, reaching back over the whole campaign

The hourly schedule only looks at 72 hours. Run it with a wide window once to
reconcile every booking made so far — it is idempotent, so this is safe to
repeat:

```bash
CRON_SECRET=$(npx vercel env pull /tmp/e --environment=production >/dev/null 2>&1 && grep '^CRON_SECRET' /tmp/e | cut -d= -f2- | tr -d '"'; rm -f /tmp/e)
curl -s -H "Authorization: Bearer $CRON_SECRET" 'https://www.stellreducation.org/api/cron/motion-bookings?hours=2000' | python3 -m json.tool
```

Reading the response:

- `booked` / `stampedNow` — contacts stamped on this run.
- `alreadyBooked` — stamped on an earlier run. Proof it is idempotent.
- `notInHubspot` — attendees with no contact record. Expected for meetings that
  did not come from a landing page; the job never creates a contact, or any
  meeting on this calendar could invent a lead.
- `considered: 0` with events on the calendar — `MOTION_BOOKING_TITLE` does not
  match the real event title.
- `skipped` — a variable from step 2 is missing.
- `500` with a `hint` — almost always step 1 was not done, or was done for the
  wrong calendar.

Then confirm in HubSpot: the contact shows `LP Call Booked` = Yes and a note
reading "Booked an intro call for 2026-09-10 15:30 UTC (via the Motion booking
link)."

Once it is running, a HubSpot list of `LP Audience is known AND LP Call Booked
is No` is your follow-up queue: people who asked for a call and never took one.

#### If you would rather not share a calendar: Zapier

Still possible, and `scripts/test-motion-webhook.ts` plus
`app/api/webhooks/motion` remain in place for it. Trigger on Google Calendar →
**New Event Matching Search**, add a **Code by Zapier** step to HMAC the body
with `MOTION_WEBHOOK_SECRET`, and POST it with **Webhooks → Custom Request**
sending the raw signed body and an `X-Motion-Signature` header. Two traps: a
plain POST action rebuilds the JSON and the signature stops matching, and the
payload must be just `{email, startTime}` — the receiver takes the first
email-shaped value it finds, and a raw calendar event contains your own address.

The cron is the better path: no task quota per booking, no HMAC to keep in sync,
and it reconciles retroactively, which a trigger-based Zap cannot.

---

## 5. Submit the live form once — DONE

Verified 2 Sep 2026: a real submission runs correctly through the live HubSpot
path, which also confirms `HUBSPOT_FORM_LANDING_PAGE` was pasted correctly.

**The flow changed after this test.** The two-step confirmation panel is gone:
a successful submission now redirects straight to the Motion calendar in the
same tab. The panel remains as the failure path only — shown when HubSpot
rejected the write, with an error line and a working manual link.

One reporting consequence, which raises the priority of item 4:
`lp_booking_click` now fires automatically on every stored submission rather
than on a click, so it is roughly 1:1 with `lead_submitted` and no longer
measures intent. **The Motion booking webhook is now the only thing that can
tell a hand-off from an actual booking.**

---

## 6. A venue name in Sanity

The Highlands Ranch event's `venue` field reads **"STEM Academy"**, but the
school is **STEM School Highlands Ranch**. Pre-existing content, not from this
work, but it now appears in the landing-page map's accessible location list, so
it is publicly visible for the first time.

Studio → Events → Colorado Space Design Challenge → Venue Name.

---

## 7. Open one planned location in Studio

The four `plannedLocation` documents were created by script and the Studio
fields have never been opened. Worth two minutes confirming they read sensibly
before someone else has to edit one.

Studio → Planned Location → Baylor University. Check the labels, the theme
radio, and that the internal-only fields (Target Season, Internal Notes) are
obviously internal. Note **Target Season and Internal Notes are deliberately
never rendered** — nothing on the site reads them.

---

## 8. `flyer_download` still has no GTM tag

Not from this session, but confirmed again while auditing the container:
`flyer_download` returns **zero occurrences** in the published `GTM-WXBRWSH`, so
every event-flyer download since 1 September has gone unrecorded.

While you are in GTM for item 3, it is the same three steps: a Custom Event
trigger on `flyer_download`, a GA4 Event tag on `G-4JQ0EXZ7KF`, and whatever
parameters the push carries. Worth doing in the same sitting rather than as its
own errand.

---

## Reference — what is already done

- Both routes live, indexed, self-canonical, in the sitemap, with generated
  per-audience OG images.
- HubSpot: 11 properties + the `Landing Page` lead source + the shared form
  (`74b755b6-d823-4073-90c4-975d523a4612`) created and verified in portal
  24379847. No archived-name collisions.
- Sanity: coordinates on the six running events, `showOnLocationMap` unticked on
  Austin and Raleigh, four `plannedLocation` documents publicly readable.
- Live counts: ten locations across eight states — six running now, four in
  planning. Environmental 2 / Space 4 / Planned 4.
- Vercel: `HUBSPOT_FORM_LANDING_PAGE`, `NEXT_PUBLIC_BOOKING_URL` and
  `MOTION_WEBHOOK_SECRET` on Production.
- 389 tests pass; token lint and deploy-ready checks clean.
