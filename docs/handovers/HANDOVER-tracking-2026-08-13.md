# Handover — website tracking (HubSpot, Meta, LinkedIn, consent)

**Session:** 13 Aug 2026 · **All code merged to `main` and deployed.**
**Companion docs:** [`docs/GTM-TRACKING-SETUP.md`](../GTM-TRACKING-SETUP.md) is the
living reference for the GTM container — read it before touching any tag.

---

## What exists now

| Layer | State |
|---|---|
| **HubSpot** portal `24379847` | 6 forms live, capture verified end to end, traffic source resolves to `DIRECT_TRAFFIC` |
| **GTM** `GTM-WXBRWSH` | GA4 `G-4JQ0EXZ7KF`, Google Ads `AW-10893614207`, Meta `974871662341253`, LinkedIn `9494738` |
| **Consent** | Consent Mode v2, banner, footer withdrawal link |
| **Cron** | `/api/cron/hubspot-lifecycle` daily 04:00 UTC |

### Key IDs

```
HubSpot portal          24379847
Meta Pixel              974871662341253
LinkedIn Partner        9494738
LinkedIn conversion     29290274   (Website lead — b2b)
GTM container           GTM-WXBRWSH
GA4                     G-4JQ0EXZ7KF
Google Ads              AW-10893614207
```

---

## The three non-obvious things

These cost the most time this session. Read them before debugging anything here.

### 1. GTM caches its container for ~15 minutes

After publishing, a normal browser reload still runs the **old** container. This
produced two wrong conclusions in one session — including a report that LinkedIn
was firing without consent when the fix had actually worked.

Before trusting any test:

```js
await fetch('https://www.googletagmanager.com/gtm.js?id=GTM-WXBRWSH', {cache:'reload'})
location.reload()
```

### 2. HubSpot writes are asynchronous

A form submission stamps the contact **Lead about 30 seconds after it returns**.
Consequences:

- A lifecycle stage written inline is overwritten a moment later.
- Deleting a contact right after a submission **does not stick** — the async
  processing re-creates it. Delete after the window.
- The **search index lags** writes and deletions. Verify by direct
  `GET /crm/v3/objects/contacts/{id}`; search returns ghosts.

Always wait ~30s before judging a lifecycle result. An early probe read at 2.5s
and reached the opposite conclusion.

### 3. GTM counts a consent-blocked evaluation against "Once per page"

A base tag set to *Once per page* that is blocked by consent at page load has
spent its one allowance and **can never fire later on that page**, no matter how
many matching triggers arrive. The tag shows *Not fired* with every trigger
filter green — which looks like a trigger problem and is not.

Both base tags therefore use **Unlimited** plus an internal guard
(`if (!window.__stellrMetaInit)` / `__stellrLiInit`). Do not "tidy" these back to
Once per page.

**Diagnostic:** in Tag Assistant, click the tag under *Tags not fired* and read
**Firing Triggers**. Green ticks per filter show whether a trigger matched.
Matched triggers + not fired = consent or firing limit, never trigger config.

---

## Architecture notes

### Lead capture (`lib/hubspot.ts`)

Three writes per capture, because each populates something the others cannot:
form submission (Recent Conversion + timeline + attribution), note engagement
(Last Activity Date), contact properties (segmentation). Everything degrades
rather than failing; a total failure dead-letters to `lead_capture_failures`
(migration 135, applied) and emails `CONTACT_EMAIL`.

**`lifecyclestage` cannot be a field on an API-created form.** HubSpot rejects
the whole form definition with an opaque `"internal error"` naming no field.
Found by bisecting field-by-field. It is stamped separately instead.

### Lifecycle reconciliation (`app/api/cron/hubspot-lifecycle`)

Newsletter / white-paper / asset-request / event-notify contacts should be
**Subscriber**, but forms stamp them Lead and HubSpot silently discards backwards
writes (PATCH returns 200, nothing changes). The fix is clear-to-empty then set,
which only works once HubSpot has settled — hence a cron, not inline.

A HubSpot workflow would be the natural home; **this portal is on a tier without
workflows**, which is why it is code.

Safety: matches `lifecyclestage = lead` exactly (never demotes MQL/customer),
3-day lookback (never demotes an old subscriber who legitimately became a lead),
capped at 100/run, and logs loudly if a clear succeeds but the set fails.

`LEAD_SOURCE_LIFECYCLE` in `lib/hubspot-fields.ts` is the single source of truth
shared by the routes and the cron — a drift there would be invisible.

### Consent (`lib/consent.ts`, `components/analytics/`)

`ConsentMode.tsx` must stay **above** `<GoogleTagManager />` in the layout head,
as a plain inline script. It also replays a stored decision inline — Consent Mode
state does not survive a page load, and doing that replay only in `useEffect`
leaves a window where tags fire in the wrong state. Verified ordering:
defaults at dataLayer 0–1, replay at 2, `gtm.js` at 3.

`CookieConsent.tsx` pushes `consent_granted` **after** `applyConsent` — the
reverse order re-blocks the tag. Google's own tags re-fire on a consent update;
third-party Custom HTML tags do not, which is why that event exists.

### dataLayer contract

`competition_page_view`, `registration_started`, `registration_submitted`,
`lead_submitted`. The last carries `lead_source` and `audience` (`b2b`/`b2c`),
derived in one place in `lib/analytics.ts` — LinkedIn keys off `b2b` to stay away
from student-facing submissions. `trackLeadSubmitted` takes a route name, never
the submitted values, so the no-PII rule holds by construction.

---

## Open items

Full table with a completion column is in the Google Doc:
**"Tracking Close-Out — HubSpot, Meta, LinkedIn (13 Aug 2026)"**.

**Highest value first:**

1. **LinkedIn misses b2b pages reached by client-side navigation.** Measured on
   production: land on `/` (non-b2b), click through to `/educators`, and `lintrk`
   is still undefined with zero LinkedIn requests. `PV — b2b pages` is a Page
   View trigger, so it only fires on a full page load — anyone arriving via the
   homepage and clicking through is invisible to LinkedIn.
   **Fix:** add a **History Change** trigger (Triggers → New → Page View →
   *History Change*) with the same Page Hostname + Page Path conditions as
   `PV — b2b pages`, as a *third* trigger on `LinkedIn — Insight Base`. Safe now
   the tag is Unlimited + internally guarded.
2. **Consent banner below 640px** never verified — the browser pane would not go
   under ~685px, tried twice. Fine at 685px (44px tap targets, no horizontal
   scroll, 9% of viewport); the stacked layout is untested.
3. `NEXT_PUBLIC_HUBSPOT_PORTAL_ID` is a Vercel *Sensitive* var and cannot be read
   back, despite being public in page source.
4. Pre-existing GTM tags (Sign Up Conversion tags, Linker, GA4) never audited.
5. **Watch:** `js.hs-banner.com` loads from HubSpot's tracking script — that is
   HubSpot's own cookie-banner loader. Nothing renders today, but enabling a
   banner in HubSpot portal settings would put a *second* cookie banner on the
   site alongside ours.

### Corrected — claimed as a gap during the session, then measured and disproved

**Meta and GA4 both track client-side navigation correctly.** This was written up
as the single biggest open item and it was wrong. It came from reasoning that
GTM's Page View triggers do not fire on history change — true — without checking
what happens downstream. Measured across two navigations on production: three
GA4 `page_view` hits and three Meta `PageView` hits for three pages, on one page
load. GA4's Google Tag sends page views on history change by default, and
`fbevents.js` does its own SPA detection. Neither needs a History Change trigger.

A first measurement did appear to show GA4 missing it — that was a 6-second
window closing before the request landed. **Measure with a generous window, and
twice, before asserting anything here.**

**Closed during close-out:** stray `CE — consent_granted (b2b)` trigger removed
from `Meta — Base Pixel`; no HubSpot chat widget is published
(`HubSpotConversations` undefined, no iframe); the privacy policy "Recent update"
banner now describes the cookie changes; and the deployed cron endpoint was
invoked against production, returning `{"scanned":0,"corrected":0,"failed":0}` —
so it runs correctly in the Vercel runtime with prod env vars. Only the scheduled
04:00 UTC trigger is unobserved.

**Deliberately not done:** Meta CAPI (defer until iOS signal loss bites);
`CompleteRegistration` not mapped (keeps an ad pixel off a minor's completed
registration — owner decision).

---

## Decisions worth not re-litigating

- **Audience is high-school, 13+.** COPPA under-13 concerns do not apply; PII
  discipline still does.
- **Everything ad-related goes through GTM**, never hardcoded — a pixel in the
  repo bypasses consent gating and needs a deploy to switch off.
- **HubSpot's script stays in code**, because `hubspotutk` is load-bearing for
  server-side attribution and consent-gating it would silently break lead source.
- **Meta and LinkedIn are scoped**, not site-wide. Neither loads on
  `app.stellreducation.org`; LinkedIn is further limited to 7 b2b pages.
- **`<noscript>` pixels dropped** from both vendor snippets. They cannot run from
  GTM, and hard-coded they would fire before consent with no way to gate an
  `<img>`.
