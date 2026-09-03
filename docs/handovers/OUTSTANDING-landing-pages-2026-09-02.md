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
| 4 | Wire Motion to the webhook | ~30 min | Knowing who actually booked |
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

## 4. Wire Motion to the booking webhook

**Priority raised.** Since the form now redirects automatically,
`lp_booking_click` fires on every stored submission and carries no information
about whether anyone actually booked. Without this webhook the funnel reads
"submitted" and stops, with nothing downstream of it at all.

The receiver is built, deployed and live:

```
https://www.stellreducation.org/api/webhooks/motion
```

It verifies an HMAC-SHA256 signature over the raw body, finds the attendee email
anywhere in the payload, and — **only for a contact that already exists** — sets
`lp_call_booked = true` and writes a timeline note. It never creates contacts, so
a booking from any other source cannot invent a landing-page lead.

This matters more than it normally would: **Motion does not support prefilling
name or email** (tested against your live booking page — `?name=`, `?email=` and
its own `?e=` are all ignored), so the email address the visitor types on both
the form and the calendar is the only join between a submission and a booking.

### 4a. Check for a native webhook first

Motion → Settings → Integrations / API. If there is a "meeting booked" webhook,
point it at the URL above and give it the secret from item 2. Done.

### 4b. Otherwise use Zapier or Make

Motion's public API is task-focused, so this is the likely path.

1. **Trigger:** Motion → "New Meeting Booked" if it exists. If not, use
   Google Calendar → "New Event" on the calendar Motion writes to, filtered to
   the "Welcome To Stellr Events with David" event type. That route works even
   with no Motion trigger at all.
2. **Code by Zapier** step (Zapier cannot compute an HMAC in a Webhooks step).
   Input fields: `email`, `startTime`, `secret` (paste the item-2 value):

   ```js
   const crypto = require('crypto')
   const body = JSON.stringify({ email: inputData.email, startTime: inputData.startTime })
   const sig = crypto.createHmac('sha256', inputData.secret).update(body).digest('hex')
   output = [{ body, sig }]
   ```

3. **Webhooks by Zapier → Custom Request:**
   - Method `POST`, URL `https://www.stellreducation.org/api/webhooks/motion`
   - Data: `{{body}}` from step 2, sent raw
   - Headers: `Content-Type: application/json` and
     `X-Motion-Signature: {{sig}}`

   It must send *exactly* the string that was signed. A "Custom Request" with a
   raw body does that; a normal Webhooks POST rebuilds the JSON and the
   signature stops matching.

   Make.com does the same with its own HMAC function.

### 4c. Confirm

An unsigned request must be rejected:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://www.stellreducation.org/api/webhooks/motion -H 'content-type: application/json' -d '{"email":"test@example.org"}'
```

- `401` — working as intended. **Verified 401 on 2 Sep 2026 after the rotation,
  so the current secret is live on production and no redeploy is needed.**
- `503` — `MOTION_WEBHOOK_SECRET` is not set on that deployment; redeploy.

Then book a real slot against your own email and check the HubSpot contact:
`LP Call Booked` should read Yes, with a note "Booked an intro call via Motion
for …".

Once this is live, a HubSpot list of
`LP Audience is known AND LP Call Booked is No` is your follow-up queue.

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
