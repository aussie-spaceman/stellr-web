# Post-deploy instructions — audience landing pages

Two things cannot be done from the repo. Both are step-by-step below.
Everything else in the build is done, tested and deployed.

Routes: `/lp/first-robotics-teachers` and `/lp/homeschool-students`.

---

## 0. First: three Vercel environment variables

Nothing below matters until these are set. Verified against the live project
(`stellr-web`, team `aussie-spaceman`) on 2 Sep 2026:
**`HUBSPOT_PORTAL_ID` and `NEXT_PUBLIC_HUBSPOT_PORTAL_ID` are already set on
Preview + Production** — nothing to do there.

| Variable | Value | Environments |
|---|---|---|
| `HUBSPOT_FORM_LANDING_PAGE` | `74b755b6-d823-4073-90c4-975d523a4612` | **Production only** |
| `NEXT_PUBLIC_BOOKING_URL` | `https://app.usemotion.com/meet/david-m-shaw/welcome` | Production + Preview |
| `MOTION_WEBHOOK_SECRET` | generate — see below | **Production only** |

**Production only for the two HubSpot-writing variables**, which corrects the
"Production + Preview" that `scripts/hubspot-setup.ts` prints. All seven
existing `HUBSPOT_FORM_*` variables are Production-only, and that is the right
call rather than an oversight: a form GUID on Preview means every preview
deployment writes real contacts into the live CRM, and there is no sandbox
portal to write them to instead. Without the GUID on Preview the route falls
back to the contacts-API path, which needs a token Preview also does not have,
so a preview submission logs and dead-letters instead of polluting the portal.

`NEXT_PUBLIC_BOOKING_URL` is safe on Preview — it is just a link — and useful
there, so set it on both.

### Commands

```bash
cd ~/Documents/GitHub/stellr-web
```

```bash
printf '%s' '74b755b6-d823-4073-90c4-975d523a4612' | npx vercel env add HUBSPOT_FORM_LANDING_PAGE production
```

```bash
printf '%s' 'https://app.usemotion.com/meet/david-m-shaw/welcome' | npx vercel env add NEXT_PUBLIC_BOOKING_URL production
```

```bash
printf '%s' 'https://app.usemotion.com/meet/david-m-shaw/welcome' | npx vercel env add NEXT_PUBLIC_BOOKING_URL preview
```

**Generate it where you can see it, then add it.** Vercel stores this as a
Secret-type variable, and a Secret cannot be read back: `vercel env pull`
substitutes `[SENSITIVE]` and the CLI has no `env get`. Pipe `openssl` straight
into `env add` and the value is gone the moment the command returns — you will
have to rotate it to learn what it is.

```bash
openssl rand -hex 32 | tee /tmp/motion-secret
```

Copy that value somewhere durable (a password manager), then:

```bash
printf '%s' "$(cat /tmp/motion-secret)" | npx vercel env add MOTION_WEBHOOK_SECRET production && rm /tmp/motion-secret
```

To rotate — which is also how to recover from having lost it:

```bash
npx vercel env rm MOTION_WEBHOOK_SECRET production
openssl rand -hex 32 | tee /tmp/motion-secret
printf '%s' "$(cat /tmp/motion-secret)" | npx vercel env add MOTION_WEBHOOK_SECRET production && rm /tmp/motion-secret
```

Then redeploy, and update the secret on the Zapier/Make side to match — the
webhook rejects anything signed with the old one.

Piping the value matters: run `vercel env add` with no stdin and it prompts
interactively, and a pasted value can pick up a trailing newline that becomes
part of the secret. `printf` (not `echo`) avoids that.

### Then confirm

```bash
npx vercel env ls production | grep -E 'LANDING_PAGE|BOOKING|MOTION'
```

Three rows. Note the "created" column resets whenever a variable is edited —
that is how an unsaved or half-typed variable gets spotted.

### Then merge — in that order

**Environment variables do not apply to deployments that already exist.**
`NEXT_PUBLIC_*` is inlined at build time, and the server-side ones are read from
the deployment's own snapshot of the environment.

So set the variables *first*, then merge — the merge triggers a fresh production
build via the Vercel git integration (about four minutes) and that build picks
all three up. Done in this order there is no separate redeploy step at all:

```bash
git checkout main && git pull && git merge feat/landing-pages-2026-09-02 && git push
```

If you merge before setting them, nothing breaks visibly — the booking button
still works, because `components/lp/LandingPage.tsx` falls back to the same
Motion URL — but leads land through the contacts-API path with no form
submission, so the conversion attribution the shared form exists to record is
lost for every submission until you redeploy. Recover with:

```bash
npx vercel redeploy --prod
```

---

## 1. Three GTM tags in `GTM-WXBRWSH`

The page pushes `lp_view`, `lp_cta_click` and `lp_booking_click` onto the
dataLayer. **A pushed event is not a recorded event.** `flyer_download` shipped
in September with no tag in the published container and every download since has
been untracked — this is the same failure mode, so it is worth the twenty
minutes.

`lead_submitted` needs nothing new: it already has a tag, and the landing pages
fire it with `lead_source: landing_page_teacher` / `landing_page_family`.

### 1a. Data Layer Variables — create these three first

Variables → New → **Data Layer Variable**, Version 2, default value empty:

| Name it | Data Layer Variable Name |
|---|---|
| `DLV - lp_audience` | `lp_audience` |
| `DLV - page_slug` | `page_slug` |
| `DLV - location` | `location` |

If `DLV - page_slug` already exists, reuse it rather than making a second one.

### 1b. Triggers — one per event

Triggers → New → **Custom Event**. Event name typed **exactly**, no wildcards,
"All Custom Events":

- `lp_view`
- `lp_cta_click`
- `lp_booking_click`

### 1c. Tags — one per event

Tags → New → **Google Analytics: GA4 Event**.

- Measurement ID: `G-4JQ0EXZ7KF`
- Event Name: the same string as the trigger
- Event Parameters:
  - `lp_audience` → `{{DLV - lp_audience}}`
  - `page_slug` → `{{DLV - page_slug}}`
  - on `lp_cta_click` only, also `location` → `{{DLV - location}}`
- Triggering: the matching trigger from 1b

**Do not add the `CE — consent_granted` trigger to these.** It fires only on the
banner click and never on a stored-decision replay, so a tag gated on it alone
misses every returning visitor. These three are analytics events under
Consent Mode, which already handles the gating.

### 1d. Verify, then publish

1. Preview → `https://www.stellreducation.org/lp/first-robotics-teachers`
2. On load, confirm `lp_view` fired and carries both parameters.
3. Click "Reserve a spot" in the hero → `lp_cta_click` with `location: hero`.
4. Submit the form → `lead_submitted`, then click "Choose a time" →
   `lp_booking_click`.
5. Use Tag Assistant's **Firing Triggers** panel on each tag — it settles
   trigger-versus-consent in one click, which is the thing that has previously
   cost hours of guessing.
6. Submit → Publish. `gtm.js` caches for roughly fifteen minutes after a
   publish, so do not judge the live site immediately.

### 1e. What to look at afterwards

The two comparisons worth building in GA4: **CTA click → submit** per audience,
and **submit → booking click**. The second is the whole point of making the call
mandatory, and `lp_booking_click` is the only signal that carries it.

---

## 2. Close the booking loop: Motion → HubSpot

The receiver is built and deployed at:

```
https://www.stellreducation.org/api/webhooks/motion
```

It verifies an HMAC-SHA256 signature over the raw body, finds the attendee's
email anywhere in the payload, and — **only for a contact that already exists** —
sets `lp_call_booked = true` and writes a note onto the timeline. It refuses to
create contacts, so a booking from any other source cannot invent a
landing-page lead.

Until this is wired, the funnel reads "submitted" and then nothing. That matters
more than it would have: **Motion does not support prefilling name or email**
(tested against the live booking page on 2 Sep 2026 — `?name=`, `?email=` and
its own `?e=` are all ignored), so the email address the visitor types on both
the form and the calendar is the only join between the two.

### 2a. Generate the secret

See step 0 — generate it somewhere you can read it before adding it, because a
Secret-type variable cannot be read back out of Vercel. If you already added one
blind, the rotate recipe in step 0 is how to get a known value.

Until it is set the route answers `503` and writes nothing — deliberately.

### 2b. Wire Motion to it

Check Motion's settings for a native webhook or integration first
(Settings → Integrations / API). If it has one, point it at the URL above for the
"meeting booked" event and give it the same secret.

**If Motion has no native webhook** — likely, its public API is task-focused —
use Zapier or Make:

1. Trigger: Motion → "New Meeting Booked" (or Google Calendar → "New Event" on
   the calendar Motion writes to, filtered to the "Welcome To Stellr Events"
   event type; that route works even if Motion itself has no Zapier trigger).
2. Action: **Webhooks by Zapier → POST**
   - URL: `https://www.stellreducation.org/api/webhooks/motion`
   - Payload type: JSON
   - Data: `email` → the attendee's email; `startTime` → the meeting start
   - Headers: `X-Motion-Signature` → the HMAC of the body

   Zapier cannot compute an HMAC in a plain Webhooks step. Either use a **Code
   by Zapier** step before it:

   ```js
   const crypto = require('crypto')
   const body = JSON.stringify({ email: inputData.email, startTime: inputData.startTime })
   const sig = crypto.createHmac('sha256', inputData.secret).update(body).digest('hex')
   output = [{ body, sig }]
   ```

   …then send `body` as a raw JSON payload with `X-Motion-Signature: {{sig}}`.
   Make.com can do the same with its HMAC function.

3. Test with a real booking against your own email, then check the contact in
   HubSpot: `lp_call_booked` should be Yes and a note should read
   "Booked an intro call via Motion for …".

### 2c. Confirm it works

```bash
# A deliberately unsigned request must be rejected.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://www.stellreducation.org/api/webhooks/motion \
  -H 'content-type: application/json' -d '{"email":"test@example.org"}'
# Expect 401.
```

A `503` means `MOTION_WEBHOOK_SECRET` is not set on that deployment.

Once `lp_call_booked` is populating, the funnel reads
submitted → booking click → booked, and a HubSpot list of
`lp_audience = first_robotics_teacher AND lp_call_booked = No` is your
follow-up queue.

---

## 3. Still outstanding after all that

- **A real submission has never run through the live HubSpot path.** The route
  has eleven unit tests against a mocked HubSpot and the browser flow was
  verified with `fetch` stubbed, deliberately, so no test contact was written
  into the production CRM. The first genuine end-to-end proof is you submitting
  the live form once and finding your own contact in the portal — check the
  contact, the note, and the `Stellr Activity Log` line.
- **The Studio fields for `plannedLocation` have never been opened.** The four
  documents were created by script. Worth opening one in the Studio to confirm
  the fields read sensibly before someone else has to edit them.
- The `cta_block` value of `lp_cta_click` is defined but never emitted — the
  reserve block holds the form rather than a button. Harmless; it is there for a
  future audience page that puts a button there instead.
