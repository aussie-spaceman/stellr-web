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

The banner flips these to granted on "Accept all".

**Google's own tags are consent-aware natively.** GA4 and Google Ads read the
signals without any per-tag configuration. Verified on production: with ads
denied, the Google Ads tag produced no `viewthroughconversion`, no
`rmkt/collect`, and no `_gcl_au` cookie, while GA4 kept collecting normally; on
"Accept all", all four Ads endpoints fired and `_gcl_au` returned. So the
existing `AW-10893614207` tag needs **no change** — it is already gated.

**Third-party tags are not.** Meta and LinkedIn templates fire regardless of
Consent Mode unless you tell them not to, so for each tag added below:

> **Consent Settings → Require additional consent for tag to fire →
> add `ad_storage`.**

Miss that checkbox and the banner is decorative for that tag, and the privacy
policy becomes untrue again. This is the single easiest thing to get wrong in
the whole setup.

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

**Variables → User-Defined Variables → New → Data Layer Variable.** Name each
variable exactly as below; the "Data Layer Variable Name" is the key the site
pushes, and Version must stay **Version 2**.

| Variable name | Data Layer Variable Name |
|---|---|
| `dlv_lead_source` | `lead_source` |
| `dlv_audience` | `audience` |
| `dlv_competition_id` | `competition_id` |
| `dlv_participation_type` | `participation_type` |

While you are here, turn on the built-in **Page Path** variable
(Variables → Configure → tick *Page Path*) — the LinkedIn scoping needs it.

### Triggers to create

**Triggers → New → Trigger Configuration → Custom Event.**

| Trigger name | Event name | Extra condition |
|---|---|---|
| `CE — lead_submitted` | `lead_submitted` | All Custom Events |
| `CE — lead_submitted (b2b)` | `lead_submitted` | Some Custom Events → `dlv_audience` **equals** `b2b` |
| `CE — registration_started` | `registration_started` | All Custom Events |
| `CE — registration_submitted` | `registration_submitted` | All Custom Events |
| `CE — competition_page_view` | `competition_page_view` | All Custom Events |

One more, for LinkedIn's base tag — **Trigger type: Page View**, name
`PV — b2b pages`, fire on *Some Page Views* where **Page Path** *matches RegEx*:

```
^/(educators|host-an-event|mentors|network|why-stellr|impact|volunteer)
```

---

## 1b. Tag settings reference

Every tag below is **Custom HTML**. The settings live in two collapsed panels on
the tag edit screen — *Advanced Settings* and *Triggering*. What each control
does, and what to set it to here.

### Tag Configuration

| Control | Set to | Why |
|---|---|---|
| **Support document.write** | **unchecked** | Only for legacy tags that call `document.write`. Ticking it makes GTM rewrite the document and can blank the page on an async load. Neither snippet needs it. |

### Advanced Settings

| Control | Base tags | Event tags | Why |
|---|---|---|---|
| **Tag firing priority** | `10` | leave `0` | Higher numbers start first within the same event. A safety net only — sequencing is the real guarantee. |
| **Tag firing options** | **Once per page** | **Unlimited** (default) | See the warning below — this one is easy to get wrong in a way that silently drops conversions. |
| **Tag Sequencing** | none | *Fire a tag before* → the matching base tag | Guarantees `fbq` / `lintrk` exists before the event tag calls it. |
| **Consent Settings** | Require `ad_storage` | Require `ad_storage` | Meta and LinkedIn ignore Consent Mode otherwise. |
| **Tag firing schedule** | leave empty | leave empty | Only for time-boxed campaigns. |

> **Do not set event tags to "Once per page".**
>
> It sounds tidier and it quietly loses data. Several pages carry more than one
> lead form — an asset gate plus the newsletter block, for instance — and a
> visitor can legitimately submit two. "Once per page" fires `Lead` for the
> first and silently discards the second. The base pixel is the opposite case:
> it must be *Once per page*, because a second `fbq('init')` re-initialises the
> pixel and can double-count `PageView`.

### Tag Sequencing, in full

On each **event** tag: *Advanced Settings → Tag Sequencing → tick* **Fire a tag
before [this tag] fires**, then:

- **Setup Tag:** the matching base tag (`Meta — Base Pixel` or
  `LinkedIn — Insight Base`)
- **Tick** *Don't fire [this tag] if [setup tag] fails or is paused*

That second checkbox matters. Without it, if the base tag is paused or blocked —
including **blocked by consent** — the event tag still runs and calls `fbq(...)`
on an undefined `fbq`, throwing a console error on every submission. With it
ticked, the event tag simply doesn't fire, which is the correct behaviour when
consent has been declined.

Sequencing coexists with *Once per page* on the base tag: if the base has
already fired this page, GTM treats the prerequisite as met and does not re-run
it.

### Consent Settings, in full

*Advanced Settings → Consent Settings* offers two radio options:

- **No additional consent required** (default) — the tag fires whenever its
  trigger fires. This is correct for Google's own tags, which read Consent Mode
  natively, and **wrong for every tag in this document**.
- **Require additional consent for tag to fire** — choose this, then
  **+ Add required consent** → type or select **`ad_storage`**.

Add only `ad_storage`. Adding `ad_user_data` and `ad_personalization` as well is
harmless but redundant — the banner sets all three together, so any one of them
is a sufficient gate, and a shorter list is easier to audit.

Once set, the tag shows a small shield icon in the tag list. Use that icon as
your checklist: **all six tags in this document must show it.**

### Triggering

| Control | Use |
|---|---|
| **Firing Triggers** | The trigger from §1. One per tag. |
| **Exceptions** | Leave empty, unless you take the "keep Meta off the registration path" option — then add a Page View trigger matching `^/register/` as an *exception* on the Meta tags. An exception beats a firing trigger, so this reliably suppresses them there. |

---

## 2. Meta Pixel

Use **Custom HTML** rather than a gallery template. The most-installed Meta
template is published by `facebookarchive` and is no longer maintained; Custom
HTML is stable, and it makes the consent setting and the exact event payload
visible in one place.

### 2a. Turn off Automatic Advanced Matching first

This is a **Meta-side** setting, not a GTM one, and it is on by default:

> Events Manager → your pixel → **Settings** → *Automatic Advanced Matching* →
> **off**.

Left on, Meta scrapes email and phone values out of form fields in the page and
hashes them into the pixel. The dataLayer deliberately carries no PII; this
setting would reintroduce it by reading the DOM directly, bypassing everything.

### 2b. Base tag

**Tags → New → Custom HTML**, name it `Meta — Base Pixel`. Replace
`YOUR_PIXEL_ID`:

```html
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'YOUR_PIXEL_ID');
fbq('track', 'PageView');
</script>
```

| Setting | Value |
|---|---|
| Triggering | **All Pages** |
| Tag firing options | **Once per page** |
| Tag firing priority | `10` |
| Tag Sequencing | none |
| Consent Settings | Require `ad_storage` |
| Support document.write | unchecked |

### 2c. Event tags

One Custom HTML tag per event. Each needs `Meta — Base Pixel` as a **setup tag**
so ordering is guaranteed rather than assumed:

> Advanced Settings → **Tag Sequencing** → tick *Fire a tag before…* → choose
> `Meta — Base Pixel`.

| Tag name | Code | Trigger |
|---|---|---|
| `Meta — ViewContent` | `<script>fbq('track','ViewContent',{content_type:'product',content_ids:['{{dlv_competition_id}}']});</script>` | `CE — competition_page_view` |
| `Meta — InitiateCheckout` | `<script>fbq('track','InitiateCheckout',{content_ids:['{{dlv_competition_id}}']});</script>` | `CE — registration_started` |
| `Meta — Lead` | `<script>fbq('track','Lead',{content_category:'{{dlv_lead_source}}'});</script>` | `CE — lead_submitted` |

`content_category` carries the route name (`newsletter`, `host_event`, …), which
is what makes the Meta reporting useful — without it every lead looks identical.

### 2d. Consent — required on every Meta tag

For **each** of the four tags above:

> Advanced Settings → **Consent Settings** → *Require additional consent for tag
> to fire* → **+ Add required consent** → `ad_storage`.

Unlike Google's tags, Meta's fire regardless of Consent Mode unless you do this.
Miss it and the banner is decorative.

**On `CompleteRegistration`:** the obvious mapping is
`registration_submitted`, but that page is the end of a flow used by
high-school students. If you would rather not have the pixel present on the
registration path at all, optimise on `InitiateCheckout` instead and add
`/register/` as a Page Path exception on the Meta tags. You lose some signal
fidelity and keep the campaign optimisation. Your call — the trigger is
one line either way.

---

## 3. LinkedIn Insight Tag

**Partner ID: `9494738`** (from Campaign Manager → Analytics → Insight Tag →
Manage Insight Tag → See tag code).

LinkedIn is a professional network, so this is scoped rather than site-wide —
firing it on a student scholarship application spends budget reaching an
audience that is not on the platform.

### 3a. Base tag

**Tags → New → Custom HTML**, name it `LinkedIn — Insight Base`. Paste exactly
this — it is LinkedIn's snippet with the Partner ID filled in and the `<noscript>`
block removed (see below for why):

```html
<script type="text/javascript">
_linkedin_partner_id = "9494738";
window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
window._linkedin_data_partner_ids.push(_linkedin_partner_id);
</script>
<script type="text/javascript">
(function(l) {
if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
window.lintrk.q=[]}
var s = document.getElementsByTagName("script")[0];
var b = document.createElement("script");
b.type = "text/javascript";b.async = true;
b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
s.parentNode.insertBefore(b, s);})(window.lintrk);
</script>
```

| Setting | Value |
|---|---|
| Triggering | **`PV — b2b pages`** — not All Pages |
| Tag firing options | **Once per page** |
| Tag firing priority | `10` |
| Tag Sequencing | none |
| Consent Settings | Require `ad_storage` |
| Support document.write | unchecked |

### Drop the `<noscript>` block

LinkedIn's copy-paste snippet ends with:

```html
<noscript>
<img height="1" width="1" style="display:none;" alt=""
     src="https://px.ads.linkedin.com/collect/?pid=9494738&fmt=gif" />
</noscript>
```

Leave it out. Two reasons, and the second is the important one:

1. **It cannot work from GTM.** `<noscript>` renders only when JavaScript is
   disabled, and GTM is itself JavaScript — if a visitor has JS off, the
   container never runs and the tag is never injected. It is dead code here.
2. **It cannot be consent-gated.** A plain `<img>` fires the moment the browser
   parses it. Consent Mode governs JavaScript tags; it has no say over an image
   request. Hard-coding this into the page — the only place it *would* execute —
   would send a request to `px.ads.linkedin.com` for every visitor before anyone
   has accepted anything, which is precisely the behaviour the banner exists to
   prevent.

The cost is losing LinkedIn attribution for JS-disabled visitors, which is a
rounding error and would be unconsented data anyway.

There is an official *LinkedIn Insight Tag* template in the Community Gallery if
you prefer it; it is well maintained. Custom HTML is used here only so both
platforms are configured the same way.

### 3b. Conversion tag

Conversions are *defined* in Campaign Manager (Analytics → Conversions → Create).
Choose **event-specific** rather than URL-based, since a lead submission does not
change the URL. Campaign Manager gives you a numeric conversion ID.

Then **Tags → New → Custom HTML**, name it `LinkedIn — Lead (b2b)`:

```html
<script>
  window.lintrk && window.lintrk('track', { conversion_id: YOUR_CONVERSION_ID });
</script>
```

| Setting | Value |
|---|---|
| Triggering | **`CE — lead_submitted (b2b)`** |
| Tag firing options | **Unlimited** (default) |
| Tag Sequencing | Fire `LinkedIn — Insight Base` before; tick *Don't fire if it fails or is paused* |
| Consent Settings | Require `ad_storage` |

The b2b trigger is what keeps LinkedIn off scholarship and event-notify
submissions — students and parents. If a b2b lead lands on a page outside the
`PV — b2b pages` list, the sequencing setup tag loads the base pixel on demand,
so the conversion still registers.

---

## 3c. Client-side navigation — read this before testing

The site is a Next.js App Router application, so moving between pages is a
**client-side** navigation: the browser does not reload and GTM's *All Pages*
trigger does **not** fire again. Consequences:

- `Meta — Base Pixel` sends `PageView` on the first page only. Subsequent
  in-site navigations send nothing.
- The custom events (`lead_submitted`, `competition_page_view`, …) are unaffected
  — they are explicit dataLayer pushes and fire correctly either way.

If you want a Meta `PageView` per virtual page, add a **History Change** trigger
(Triggers → New → Page View → *History Change*) and a second tag firing
`fbq('track','PageView')` on it, sequenced after the base tag. Do not add
History Change to the base tag itself, or `fbq('init')` runs repeatedly.

Worth checking the same question for the existing GA4 tag while you are in
there — if it was configured without *Send a page view event on history change*,
GA4 has been under-counting in-site navigation all along.

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
