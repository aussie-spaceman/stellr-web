# Runbook — no advertising for students (Privacy Policy §9.4)

**Since:** 02-Oct-2026 · **Owner:** David · **Code:** `lib/no-ads.ts`

§9.4 promises that advertising cookies and tags (Google Ads remarketing, Apollo.io,
and anything else in the Advertising category) are never loaded on registration
pages, on the participant platform, or for any signed-in student, whatever the
cookie settings, and never for a child under 13 even after "Accept all".

The ad tags live in the GTM container (`GTM-WXBRWSH`), not in this repo, so this
is enforced in two halves. **Both must be in place before the policy text is
live.**

## Half 1 — code (shipped with the 02-Oct-2026 legal update)

| Where | What it does |
|---|---|
| `components/analytics/ConsentMode.tsx` + `lib/no-ads.ts` `noAdsScript` | Inline, before GTM. On a no-ads page, on the member-app host, or in a browser carrying the `stellr_no_ads` cookie: does **not** replay a stored "Accept all", keeps `ad_storage` / `ad_user_data` / `ad_personalization` denied, sets `ads_data_redaction: true`, `allow_google_signals: false`, `allow_ad_personalization_signals: false`, and pushes `stellr_no_ads: true` to the dataLayer. Wraps `history.pushState/replaceState` so a client-side navigation into a student page denies again **before** GTM's `gtm.historyChange`. |
| `lib/consent.ts` `applyConsent` | Refuses to grant advertising while no-ads is active (banner "Accept all" is stored but not applied). |
| `components/analytics/CookieConsent.tsx` | No `consent_granted` event on a no-ads page, so consent-triggered tags are not woken. |
| `components/analytics/NoAdsStudentMarker.tsx` (member layout) | When a student (under 18, high school bracket, or DOB unknown) signs in, sets the `stellr_no_ads` cookie on `.stellreducation.org` for a year and calls HubSpot `doNotTrack`. Outlives sign-out on purpose (shared family devices). |
| `components/analytics/HubSpotTrackingNoAdsGate.tsx` | The HubSpot tracking script is never rendered in a student-marked browser. |

No-ads paths: `/register`, `/sign-in`, `/sign-up`, `/home`, `/community`, `/account`,
`/join`, `/campaigns`, `/credentials`, `/check-in`, `/admin`, `/studio`, and every
page on `app.stellreducation.org`.

Verified locally on 02-Oct-2026 against the live container, with "Accept all" stored:

- `/educators` loaded `gtag/js?id=AW-10893614207` and fired `googleads.g.doubleclick.net/pagead/viewthroughconversion/…`, `google.com/rmkt/collect/…` and `pagead/1p-user-list/…`.
- `/sign-up` (hard load) loaded GA4 only; zero Google Ads, DoubleClick, Meta, LinkedIn or Apollo requests.
- Client-side navigation from `/educators` (Ads tag already loaded) to `/community`: consent denied + `stellr_no_ads: true` landed before `gtm.historyChange`; zero ad requests after the navigation.

## Half 2 — GTM (David, before promoting)

Without this, a tag running in advanced Consent Mode can still send cookieless
pings, and the Meta and LinkedIn Custom HTML tags do not read Consent Mode at
all. This is what makes "never loaded" true.

1. **Variables → New → Data Layer Variable.** Name `DLV - stellr_no_ads`, Data
   Layer Variable Name `stellr_no_ads`, version 2, default value `false`.
2. **Triggers → New → Custom Event.** Name `Block - Student / no-ads`, event name
   `.*` with "Use regex matching" ticked, fires on **Some Custom Events** where
   `DLV - stellr_no_ads` equals `true`.
3. On **every** advertising tag — Google Ads (conversion, remarketing, the Google
   tag for `AW-10893614207`), Meta Base Pixel and Meta events, LinkedIn Insight
   and conversion, Apollo.io — open Triggering → **Add Exception** →
   `Block - Student / no-ads`.
4. GA4 tag (`G-4JQ0EXZ7KF`): no exception; analytics stays. The code already
   turns off Google signals and ad personalization on no-ads pages.
5. **Preview** (Tag Assistant), then **Submit → Publish** with the version name
   `No ads for students (Privacy §9.4)`.

## Evidence for the PR / audit (Tag Assistant)

1. Tag Assistant on `https://www.stellreducation.org/educators`, click **Accept all**:
   Google Ads + Meta fire (control).
2. Same session, navigate to `/register/<any-event>/individual`: Summary shows
   `stellr_no_ads: true`; **Tags Not Fired** lists every advertising tag
   (blocked by the exception).
3. Sign in as an under-13 test member on `app.stellreducation.org`, then open
   `https://www.stellreducation.org/educators` and click **Accept all**: zero
   advertising tags fire; `stellr_no_ads` cookie present; no `js.hs-scripts.com`
   request.
4. Screenshot steps 2–3 and attach them to the legal-update PR.

## If you add a new advertising tag

Add the `Block - Student / no-ads` exception to it **before** publishing. A tag
without it breaks §9.4 for every student.
