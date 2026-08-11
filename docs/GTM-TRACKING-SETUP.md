# GTM tracking setup — Meta and LinkedIn

Everything the site can do in code is done. What remains is container
configuration in the GTM UI, which is deliberate: a pixel hardcoded in the repo
bypasses the consent gate and cannot be switched off without a deploy.

Container: **GTM-WXBRWSH**. Already firing GA4 `G-4JQ0EXZ7KF` and Google Ads
`AW-10893614207`.

**You need two IDs before starting:**

| Platform | Where to get it |
|---|---|
| Meta Pixel ID | Events Manager → Data Sources → your pixel |
| LinkedIn Partner ID | Campaign Manager → Analytics → Insight Tag |

---

## 0. Consent — do this first

The site now ships Google Consent Mode v2
(`components/analytics/ConsentMode.tsx`). Defaults, applied before the container
loads:

| Signal | Default | In UK/EEA/CH |
|---|---|---|
| `ad_storage`, `ad_user_data`, `ad_personalization` | **denied** | denied |
| `analytics_storage` | granted | **denied** |

The banner flips these to granted on "Accept all". **Consent Mode only withholds
what a tag is configured to check** — so this is load-bearing:

> In GTM, every advertising tag below must have
> **Consent Settings → Require additional consent for tag to fire →
> `ad_storage`**.

Without that checkbox the tag fires regardless of the banner, and the privacy
policy becomes untrue again. Also confirm the existing **Google Ads tag
`AW-10893614207`** gets the same treatment — it is currently firing
unconditionally.

---

## 1. The dataLayer contract

Pushed by `lib/analytics.ts`. All values are non-identifying by construction —
`trackLeadSubmitted` takes a route name, never the submitted values.

| Event | When | Parameters |
|---|---|---|
| `competition_page_view` | Event/campaign detail page | `competition_name`, `competition_id`, `participation_type` |
| `registration_started` | Registration form opened | `competition_name`, `competition_id`, `participation_type` |
| `registration_submitted` | Registration confirmation page | above + `registration_ref` (opaque) |
| `lead_submitted` | **Any lead form accepted by the server** | `lead_source`, `audience`, sometimes `competition_id` / `registration_interest` / `asset` |

`lead_source` is one of: `newsletter`, `event_notify`, `white_paper`,
`asset_request`, `scholarship`, `host_event`, `contact`, `join_network`.

`audience` is `b2b` or `b2c`, derived in one place from `lead_source`:

- **b2b** — `white_paper`, `asset_request`, `host_event`, `join_network`, `contact`
- **b2c** — `newsletter`, `event_notify`, `scholarship`

### Variables to create

Data Layer Variables (Variables → New → Data Layer Variable), name them to match:

`dlv_lead_source`, `dlv_audience`, `dlv_competition_id`, `dlv_participation_type`

### Triggers to create

| Trigger name | Type | Condition |
|---|---|---|
| `CE — lead_submitted` | Custom Event | Event name `lead_submitted` |
| `CE — lead_submitted (b2b)` | Custom Event | `lead_submitted` **and** `dlv_audience` equals `b2b` |
| `CE — registration_started` | Custom Event | Event name `registration_started` |
| `CE — registration_submitted` | Custom Event | Event name `registration_submitted` |
| `CE — competition_page_view` | Custom Event | Event name `competition_page_view` |

---

## 2. Meta Pixel

Tag → New → **Meta Pixel** (community template, by facebookarchive) or Custom
HTML. Pixel ID from Events Manager.

| Meta event | Trigger |
|---|---|
| `PageView` | All Pages |
| `ViewContent` | `CE — competition_page_view` |
| `InitiateCheckout` | `CE — registration_started` |
| `Lead` | `CE — lead_submitted` |

**Turn Advanced Matching OFF.** It hashes email and phone into the pixel. The
dataLayer carries no PII precisely so this can't happen by accident, and
enabling it would reintroduce the exposure through the back door.

**On `CompleteRegistration`:** the obvious mapping is
`registration_submitted`, but that page is the end of a flow used by
high-school students. If you would rather not have the pixel present on the
registration path at all, optimise on `InitiateCheckout` instead and add
`/register/` as a Page Path exception on the Meta tags. You lose some signal
fidelity and keep the campaign optimisation. Your call — the trigger is
one line either way.

---

## 3. LinkedIn Insight Tag

Tag → New → **LinkedIn Insight Tag** template. Partner ID from Campaign Manager.

LinkedIn's audience is adults and professionals, so scope it rather than firing
site-wide. Two changes from the Meta setup:

1. **Base tag trigger:** not All Pages. Create a Page View trigger limited to
   Page Path matching RegEx:
   `^/(educators|host-an-event|mentors|network|why-stellr|impact|volunteer)`
2. **Conversion trigger:** `CE — lead_submitted (b2b)` — the audience variable
   exists for exactly this. It keeps LinkedIn off scholarship and event-notify
   submissions, which are students and parents.

Conversions themselves are defined in Campaign Manager. For event-based rather
than URL-based conversions, add a Custom HTML tag on the b2b trigger:

```html
<script>
  window.lintrk && window.lintrk('track', { conversion_id: YOUR_CONVERSION_ID });
</script>
```

---

## 4. Verification

In GTM **Preview** mode, walk each path and confirm:

- [ ] Before accepting the banner: Meta and LinkedIn tags show as **blocked by consent**
- [ ] After "Accept all": the same tags fire
- [ ] After "Essential only": they stay blocked, and GA4 still reports
- [ ] `lead_submitted` fires once per successful submission, never on a validation error
- [ ] `audience` is `b2b` on the white-paper gate and `b2c` on a scholarship submission
- [ ] LinkedIn base tag does **not** load on `/scholarship` or `/register/...`
- [ ] No email, name, or phone in any outbound tag payload (Network tab)

Browser extensions worth having: **Meta Pixel Helper**, **LinkedIn Insight Tag
Helper**, **Google Tag Assistant**.

---

## 5. What is deliberately not here

- **Meta Conversions API.** Server-side, deduplicated on `event_id`. Worth doing
  if iOS signal loss becomes a real constraint; not worth the complexity before
  there is a campaign to measure.
- **HubSpot's script in GTM.** It stays in code
  (`components/analytics/HubSpotTracking.tsx`) because the `hubspotutk` cookie is
  load-bearing for server-side form attribution — routing it through a
  consent-gated container would silently break lead source attribution whenever
  someone declines. HubSpot's cookies are first-party analytics and are
  disclosed in privacy policy §9.
