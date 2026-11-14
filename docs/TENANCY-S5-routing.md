# Tenant routing: runbook

How a request on a tenant host reaches the app, what fails closed, how to classify a new route, and how to turn routing on and back off. Built by B1, B2, B5 and B7. Plan of record: `docs/TENANCY-S5.md`. Code wins over this file; if they disagree, fix this file.

## Where it stands

`TENANT_ROUTING_ENABLED` defaults to off, and nothing in this work sets it. With it off, the tenant branch in `proxy.ts` is one string comparison. Attaching a real zone is an owner gate that has not happened. The dev canary zone, `.devzone.stellreducation.org` on `stellr-web-dev` only, is approved and its cookie review done (13 Nov 2026), but it is not attached yet: [The dev canary zone (K6)](#the-dev-canary-zone-k6).

**Tenant hosts are not ready to serve anyone.** The code this table used to list is built and on production: B5b, B8 and B10a merged in #563 and B5c, B6, B9 and B10 in #578, both promoted in #587 (9 Nov 2026); A7 merged in #594 and was promoted in #600; the production zone guard (`W7-27`) is on production since #680 (14 Nov 2026 UTC). What still has to pass before a real zone gets the flag (re-checked 14 Nov 2026):

| Needs | Because |
|---|---|
| B5c's fallback rewrite on Vercel | The `missing: host` rewrite and `experimental.globalNotFound` have run only on harness builds (`docs/TENANCY-S5.md`, wave 4, Not yet proven) |
| B6 on a hosted canary, and B10(d) in a browser | One enforcing CSP on `/sign` and `/survey/x`, Clerk sign-in and sign-up with Turnstile under it with 0 violations, and 0 trackers on a tenant host: none has run on a deployment |
| C6's cap at 0, and B10(c) | 48 tenant-host cases still fail and 18 are unproven (`test/baselines/tenant-host-idor.json`); A11 and A12 remain. The Stellr-host rows in `e2e/tenancy/host-cases.ts` are recorded outcomes, which a person checks at sign-off |
| The `Real tenant hosts` owner gate | G5 subzone, Vercel Pro, Clerk session sharing and FAPI origins, the cookie review below |

## How a host resolves

`lib/tenancy/host.ts`, in this order. The pure rules are in `lib/tenancy/host-pure.ts`, which client code may import. `lib/tenancy/host.ts` holds the secret key handling and may not reach a browser.

1. `TENANT_ROUTING_ENABLED` is not exactly `true`: Stellr. Nothing else is read.
2. The host is normalised (lower case, no port, no trailing dot) and validated. Invalid is `invalid`, never Stellr.
3. `TENANT_HOST_SUFFIX` is unset or refused, or is a dev zone on the real production app: a known Stellr host stays Stellr, and any other host is `unavailable` (`zone-misconfigured`).
4. The host is outside the zone: Stellr, by string comparison, with no fetch. That covers www, app, the apex, `*.vercel.app`, localhost and IP literals.
5. Inside the zone, the cached host map decides: platform owner is Stellr, another active tenant is that tenant, no row or an inactive tenant is `not-found`, and a map that cannot load is `unavailable`.

A suffix is refused when it could swallow Stellr's own hosts. It must be `.localhost`, end in `.localhost` or `.test`, or have at least three labels. Anything under `.vercel.app` is refused too.

The Host header decides. `X-Forwarded-Host` and `Forwarded` are ignored.

**The map.** The whole active map, from one raw PostgREST fetch of `tenant_domains` joined to `tenants` with status `active`. Per instance: fresh for 60 s, usable for another 60 s while it refreshes, 5 s cooldown after a failed load, 2 s fetch timeout. So a suspended tenant or a reassigned host can lag by 2 minutes per instance, and that is also how long a PostgREST outage can last before tenant hosts answer 503.

**Custom domains are not supported.** Only hosts inside the zone read the map. A `tenant_domains` row outside the zone is loaded and never read: that host gets the Stellr path, with trackers off because it is not a known Stellr host. Provisioning must refuse such a row until a slice adds support.

### Why Stellr is never rewritten

Stellr's pages stay at their own paths, outside the tenant tree. A platform-owner host resolves to `stellr` and takes the normal path. `activeTenantBySlug` and `tenantFromParams` refuse the owner, so `/_t/stellr` cannot render even by rewrite. A Stellr host never reaches the map under a production zone, so routing adds no database call there, flag on or off.

## What each outcome answers

| Resolution | Answer | Never |
|---|---|---|
| `stellr` | The normal path, unchanged | |
| `tenant` | The allow-list below | Falls through to the Stellr path |
| `not-found`, `invalid` | 404, `no-store`, `X-Robots-Tag: noindex` | Stellr |
| `unavailable` | 503, `no-store`, `Retry-After: 30` | Stellr |

The tree answers 404 to a direct request on every host, flag on or off, by any spelling (`/_t`, `/%5Ft`, `/%5ft`, `/_%74`, a double encoding), dotted paths included. `isInternalTenantTreePath` compares the decoded first segment.

On a tenant host, `tenantHostRoute` in `lib/tenancy/tenant-surface.ts` decides:

| Route | When | Answer |
|---|---|---|
| `home` | `/` | Rewritten to the tree's neutral page: no Stellr content, no tenant data |
| `robots` | `/robots.txt` | Disallow all, until S10 |
| `page` | An allowed page | Clerk runs, then a rewrite to `/_t/{slug}{path}`. No tenant headers: the tenant comes from the URL |
| `api` | An allowed API | Clerk runs, then the trusted headers are set |
| `static` | A file with a static extension whose first segment is not a route | Passes through with no session |
| `denied` | Everything else | 404 before Clerk runs |

`/account/onboarding` still needs a session and `/credentials` keeps its rate limit on a tenant host. `/admin` is a 404 even with an admin claim, because a Clerk role is valid on every host until `lib/authz` checks membership.

An unmatched path in the tree renders the tree's own 404, not Stellr's.

## The tree folder: `app/%5Ft`

A folder named `_t` is private to Next and never routes, so `app/_t` silently 404s. The folder is `app/%5Ft`, which serves `/_t`. The rewrite target stays `/_t/{slug}`.

`/` on a tenant host is decided in B5: the neutral page, so a visitor who trims a link to the bare host gets a real answer, and an active host can be told from an unknown one. It is not on the allow-list because the manifest's `/` is Stellr's marketing home, so the proxy handles it through `tenantHostRoute`. A later slice may replace it with the tenant's event list.

## Trusted headers

`x-stellr-tenant-id` and `x-stellr-tenant-slug`. A client can send them, so every proxy branch deletes both, and only the tenant branch sets them, on allowed APIs. When a request carries neither, the Stellr response is exactly what it was before routing existed, with no request-header override.

| Reader | Source | Rule |
|---|---|---|
| A page in the tree | `tenantFromParams(params)` | Only source of the tenant. 404 unless the slug is an active non-owner tenant, or if the map cannot load |
| An API route | `requestTenant()` | `app/api/**` only. Headers are trusted only on a request the proxy ran on. One header without the other, or a value that does not parse, throws |
| Identity helpers | Neither | A session is the same person on any host |

`requestTenant()` returns Stellr without reading the request while the flag is off, so it costs nothing and cannot turn a static render dynamic. `test/proxy-tenant-routing.test.ts` fails if anything under `app/` outside `app/api`, or a route the proxy skips, can reach it. `proxy.ts` may not import it, because it pulls in `next/headers`.

Routes that skip the proxy never have trustworthy headers: `api/img` and `api/csp-report`.

## The matcher

`proxy.ts` `config.matcher` has four entries. The last two are for routing.

1. The existing entry, which leaves out URLs with a static extension.
2. The existing API entry.
3. A first segment starting `%`, `_t` or an encoded `_t`, so the tree's 404 covers dotted paths.
4. **Any host that is not one of Stellr's own**, using `missing` on the host. On those hosts only `_next`, `api/img` and `api/csp-report` skip the proxy, so every other path reaches the allow-list.

Entry 4 is the only part of B5 that a flag cannot gate, because Next reads the matcher statically. On Stellr hosts it matches nothing, and neither it nor entry 3 adds a proxy run for normal traffic. The hosts are named literally, so the entry does not depend on the zone setting. **Attaching a new Stellr domain means adding it to this entry and to `lib/tenancy/host-pure.ts`,** or each of its static files runs the proxy and Clerk. `test/proxy-tenant-routing.test.ts` keeps the two in step, apart from the local `[::1]`.

The owner's acceptance of entry 4 is conditional on one live check on the `dev` alias after merging, before any promotion that carries B5:

- a static file, for example `/images/logo-horiz.png`, answers 200 with no `content-security-policy-report-only` header, so the proxy did not run;
- `/_t/stellr` and `/%5Ft/stellr/x.png` answer 404;
- a normal page such as `/about` answers as before.

**Passed on `stellr-web-dev.vercel.app`, 5 Nov 2026.** Static files were checked both from the CDN cache (`/images/logo-horiz.png`) and on a cache miss (`/email/signature-logo.png`). `/about` still carries the header, so the proxy runs on pages. This does not measure Active CPU under real traffic. The acceptance itself is still the owner's.

If the owner prefers no host-keyed entry on production, the fallback is to drop entry 4 and carry the dotted-path risk on tenant hosts that `docs/TENANCY-S5.md` describes.

## Classifying a new route

Every entry in `ROUTE_MANIFEST` takes exactly one decision in `lib/tenancy/tenant-surface.ts`. `test/tenant-surface-routes.test.ts` fails on none, or on more than one, so a new route is denied on tenant hosts until someone classifies it.

| Decision | Meaning | Use when |
|---|---|---|
| `allow` | Reachable on a tenant host. By exact file only, so a new file in an allowed area still has to be named | A participant needs it on the organiser's host, and it checks the record's tenant |
| `pending` | Wanted, not yet reviewed or safe. Denied until the owner rules | Name what must change first |
| `deny` | Never served there, with a reason | Community and home (SMMA), admin, crons, webhooks, Stellr's store, academy, campaigns, membership and lead capture. A `(public)` page no rule names falls back to `deny` |
| `bypass` | The URL skips the proxy, so it cannot be gated | `api/img`, `api/csp-report`, the two webmanifests |

Allow grants reachability only. It says nothing about what a page renders. Each handler must still check that the resource's tenant matches the host tenant. Adding to `allow` also:

- puts the route in C6's tenant-host suite (`test/idor/tenant-host-routes.test.ts`), in both directions, Stellr included. A new failing case is refused, and `test/baselines/tenant-host-idor.json` only falls;
- needs a wrapper page under the tree (B5b), which takes the tenant from params and answers 404 for another tenant's record. A bare re-export is not enough;
- is a final-list decision for the owner.

## CSP

Still Report-Only on every host (`lib/csp.ts`). B6 makes it enforcing per tenant host.

`cspFor(pathname)` runs on the **original** path, before the rewrite. So a tenant host's `/register/...`, `/sign`, `/survey/...`, `/check-in/...`, `/team-profile/...`, `/sign-in`, `/sign-up`, `/account/...` and `/api/...` get the nonce policy. `/`, `/credentials/...`, `/privacy` and `/terms` get the host policy, which allows inline script and names the script hosts.

Under B6 those host-policy pages need a decision: with no per-request nonce, an enforcing policy has to allow inline script, or they have to render per request. The tree's home page already does (`force-dynamic`). Per-request rendering or ISR remains an owner decision.

`ConsentMode`, the un-nonced head script from `app/layout.tsx`, would break under an enforcing policy. It is allowed by hash on nonce routes today. B5c moves it to a Stellr root layout.

### `headers()` in the tree

`docs/S4-SPIKE.md` section 5 asked for a ban on `headers()` under the tree. The rule is now: **a page may not use `headers()`, `Host` or a cookie to decide the tenant.** The lint runs over the tree's import closure, since the code sits in `app/(flow)` and `lib/`, and each `headers()` or `cookies()` call in it is listed by name with its reason. Two are known: `requestNonce` (`lib/request-nonce.ts`), for pages that already render per request, and the `cookies()` call in `app/(flow)/check-in/[slug]/page.tsx`. B5b builds the lint.

## Trackers (B7)

`SiteTracking` mounts GTM, HubSpot, Vercel Analytics and Speed Insights only on Stellr's own hosts. `pushDataLayer` does nothing elsewhere and creates no `dataLayer`. The check is `isStellrTrackingHost`, an allow-list that runs in the browser with no zone, because browser code cannot read server env. So an unset or refused zone keeps trackers on www and off every other host.

`test/tenant-tree-no-analytics.test.ts` walks the import closure of `app/%5Ft` and forbids the analytics modules. **What B7 does not stop:** the `ConsentMode` head script still runs on a tenant host until B5c. It creates `window.dataLayer`, replays a stored choice and shows the banner at first paint, with no network request. B5b also has to move `TrackEvent` and `lib/analytics` out of the shared register pages, or the closure test fails.

## Cookies on `.stellreducation.org`

If the tenant zone sits under `stellreducation.org`, a browser sends any `Domain=.stellreducation.org` cookie to every tenant host. This is a privacy-notice point. It decides the cookie review in the `Real tenant hosts` gate.

| Cookie | Scope today | On a tenant host |
|---|---|---|
| `stellr_no_ads`, from `NoAdsStudentMarker` | `domain=.stellreducation.org` on any host ending in `stellreducation.org`. The only parent-domain cookie this repo's code writes | Sent to the tenant host. **Not written there:** since B7 the marker does nothing off Stellr's hosts |
| Strict-region cookie, from `proxy.ts` | Host-only, no `Domain` | Not set: the tenant branch does not run `withRegionCookie` |
| View-as cookie | Host-only on app | Not sent |
| Clerk's own cookies | Set by Clerk | **Checked for the dev zone, 13 Nov 2026** (below): `__client_uat` and its suffixed form sit on the registrable domain and cross between production and the dev zone in both directions; `__session`, `__client` and `__clerk_db_jwt` are host-only and do not. Session sharing for a production zone is still part of the same gate |
| GTM, GA and HubSpot cookies (`_ga`, `_gcl_au`, `hubspotutk`, `__hstc` and the rest) | Set by those scripts on `.stellreducation.org` from www | **Sent to every host in a zone under `stellreducation.org`.** No code or tracker on a tenant host reads or forwards them. Harmless for the dev zone; the privacy-notice point for the production `.events` zone |

**The no-ads gap.** A student who signs in only on a tenant host is not marked for Stellr's www in that browser, so if advertising was previously accepted there, www can grant it. Privacy Policy section 9.4 promises otherwise. Either accept and record it, or have a tenant-tree server action or a small non-analytics module set the fixed bit for zone hosts under `stellreducation.org`. A tenant on a custom domain could not share the cookie either way.

**Accepted (`W7-26`, 13 Nov 2026).** The owner accepted the gap: it is recorded as known and accepted for now, and no setter is built. The dev zone must not try to prove one, because a dev-zone write would be read by production www, so the dev zone writes no parent-domain cookie. The marker is still never written off Stellr's hosts, which is correct for the dev zone: it neither closes nor widens the gap. If a setter is built later, it sets only the fixed `stellr_no_ads=1` (no identifier; `Path=/`; `SameSite=Lax`; `Secure`; a year; `Domain=.stellreducation.org`), only on zone hosts under `stellreducation.org` and only for a member for whom `isStudentForAds` is true, and never loads `lib/analytics`, so `test/tenant-tree-no-analytics.test.ts` stays green. The question comes back before a production tenant zone under `stellreducation.org`.

## Bypasses on a tenant host

- `public/` assets, the webmanifests and `/api/img` stay Stellr-branded. The webmanifests pass through as static files.
- The unscoped `next.config.mjs` redirects fire before the allow-list. Next applies them ahead of the proxy.
- The tree's metadata is neutral (`Event site`, noindex), but the root layout's is not, until B5c.

## Turning it on

Each step needs the owner's yes. On `dev` first, then production, one Vercel project at a time. On `stellr-web-dev`, Claude sets the variables with the Vercel CLI after that yes (`W7-18`); production stays the owner's track. For the dev canary zone, follow [The dev canary zone (K6)](#the-dev-canary-zone-k6), which attaches two named hosts instead of a wildcard. On each:

1. Create the `tenant_domains` rows and confirm the tenant is `active`. Do not attach anything yet.
2. Set `TENANT_ROUTING_ENABLED=true` and `TENANT_HOST_SUFFIX`, and redeploy the newest READY deployment.
3. Confirm the deployment is serving the new code: READY for the expected commit, and the health endpoint reports the new value (`W7-19`). Read `GET /api/admin/health/integrations` as an admin: `tenantRouting.suffixError` must be null and `tenantRouting.enabled` true. It never shows the zone itself.
4. Confirm www and app answer as before.
5. Attach the wildcard domain.
6. **Straight away,** check that an unknown host in the zone answers 404. Detach if it does not.
7. Check a mapped host: `/` answers the neutral page, `/admin` and a community path answer 404, and an allowed page renders.

**Why this order.** With the flag off, the resolver says Stellr and `proxy.ts` compares the host only to `APP_HOST`, so a tenant hostname would get the full Stellr surface: `/admin`, community and trackers. The same happens if the suffix does not cover the zone. Never attach a zone before the flag and suffix are live and confirmed.

## Rolling it back

1. **Detach the zone first.**
2. Then remove the flag and redeploy the newest READY deployment.

Flipping the flag first exposes the zone to the Stellr surface until the domain is gone. To suspend one tenant, set its status: its hosts turn to 404 within 2 minutes per instance.

## The dev canary zone (K6)

**Decided 13 Nov 2026 (`W7-24`, option B):** the dev canary zone is a subdomain of `stellreducation.org`. `TENANT_HOST_SUFFIX=.devzone.stellreducation.org` is set on `stellr-web-dev` only, with two explicit hosts: `canary.devzone.stellreducation.org` (mapped to the `dev-canary` tenant) and `nobody.devzone.stellreducation.org` (left unmapped, the probe host). Whether the zone stays after K9, or dev tenant testing moves to a separate registrable domain, is decided after K9, once K9 has recorded how Clerk sign-in behaves on the devzone hosts (`W7-28`). Nothing is attached yet. Each step below needs the owner's yes at the time.

### The cookie review: safe with conditions

A read-only review on 13 Nov 2026, before the zone was approved. Nothing was changed.

- **Clerk's cookies.** Installed: `@clerk/nextjs` 7.9.18, `@clerk/backend` 3.26.3, `@clerk/shared` 4.42.0, `@clerk/react` 6.18.2. Each writes suffixed cookies (`__session_<suffix>`, `__client_uat_<suffix>`, `__clerk_db_jwt_<suffix>`, the suffix a hash of the publishable key), and **still writes and reads the unsuffixed names** for backward compatibility. The suffix lowers the risk of a collision; it does not remove it.
- **What crosses.** `__client_uat`, both names, sits on `stellreducation.org`: production's Clerk frontend API sets it, and on the devzone hosts the dev instance's browser code sets it with the same domain. So production's value reaches the canary hosts, and a dev sign-in there writes `__client_uat` and `__client_uat_<devSuffix>` that www and app then receive. The unsuffixed dev cookie has production's name, domain and path, so it overwrites production's in that browser. **No session credential crosses:** `__session` and `__clerk_db_jwt` are host-only, `__client` is host-only on Clerk's frontend API host, and a token from one instance does not verify against the other. The effect is functional, not a leak: a browser used on both can get extra handshake redirects or briefly show signed out on production. Not verified: if production's short-lived `__clerk_handshake` cookie were domain-scoped and reached a devzone host, the dev backend would answer that one request with a 500. Only browsers that visit the dev zone are affected, and members have no reason to.
- **Clerk's guidance.** Clerk warns that a second production instance on the production domain will not work. This is a development instance (`pk_test_`); Clerk does not document that case. The cookie suffix is what makes it workable.
- **The app's own reader.** `lib/session-hint.ts` treats any non-zero `__client_uat` or `__client_uat_*` as a signed-in hint. After a tester signs in on a devzone host, www and app (the navbar, `useMemberPrefill`, `useMemberCampaigns`) show a signed-in hint in that browser, which costs one request at most. It is a hint only and grants nothing. A tester who sees a signed-in navbar on www has not signed in to production.
- **The app's cookies.** Only `stellr_no_ads` has a parent `Domain`, and it is never written on the dev zone (above). Every other app cookie is host-only and never reaches the zone: the strict-region cookie, the view-as cookie, the check-in cookie (path-scoped), the e-sign session cookie (`SameSite=Strict`). Consent is in `localStorage`, per origin. There is no Sanity draft or preview cookie.
- **The zone rules.** `normaliseZoneSuffix` accepts `.devzone.stellreducation.org` (three labels, not under `.vercel.app`), and `classifyHost` keeps www, app, the apex, `devzone.stellreducation.org` itself and `stellr-web-dev*.vercel.app` outside the zone, on the Stellr path. **The zone apex must never be attached:** it would get the full Stellr surface.
- **Not refused on the wrong project.** `isDevZoneSuffix` knows only `.localhost` and `.test`, so this suffix set on production (with the flag on) would be accepted, and real tenant hosts under `.events.stellreducation.org` would fall outside the zone and get the Stellr surface. The reverse, the production zone set on `stellr-web-dev`, is not refused either, and the canary runner's production-host list is exact, so it would not refuse `canary.events.stellreducation.org`. The devzone hosts themselves cannot reach production, because Vercel attaches a host to one project only. While production's flag is off its suffix is never read, so this does not block K6. **Since built (`W7-27`, #675, on `dev`, not promoted):** the production zone guard (`W7-27`, below).
- **Vercel and DNS.** `stellreducation.org` is on the `stellreducation` team, with GoDaddy nameservers (`ns05` and `ns06.domaincontrol.com`), not Vercel DNS. `stellr-web` holds the apex, www and app; `stellr-mta-sts` holds `mta-sts`; `stellr-web-dev` has no custom domain. A subdomain can normally be attached to a second project in the same team without an ownership record; if Vercel asks, it shows a `_vercel` TXT record. Hobby allows 50 domains per project. On 13 Nov 2026 `canary.devzone`, `nobody.devzone`, `devzone` and a random label were all NXDOMAIN, so there is no wildcard; the apex has no CAA record, so Vercel's certificates are not blocked.
- **Search engines.** Tenant hosts already answer `/robots.txt` with `Disallow: /`, the tenant layout and flow pages set `noindex, nofollow`, and the proxy's 404 and 503 carry `X-Robots-Tag: noindex`. A disallowed URL could still be indexed URL-only if something linked to it; nothing does. Optional hardening: `X-Robots-Tag: noindex, nofollow` on every tenant-host response. Never add these hosts to Search Console.
- **Analytics.** Trackers are off on the devzone hosts by allow-list (`isStellrTrackingHost`), whatever the zone, and `test/tenant-tree-no-analytics.test.ts` guards the import closure. B5c (#578, on production since #587) gave the tenant tree its own root, so the `ConsentMode` head script does not run on a tenant host.

### Conditions

1. Attach exactly two hosts, `canary.devzone.stellreducation.org` and `nobody.devzone.stellreducation.org`, to `stellr-web-dev` only. No wildcard; no record and no attachment for `devzone.stellreducation.org`; no NS delegation; nothing on `stellr-web`.
2. In order: the K3 seed rows on the `dev` database first (canary mapped and its tenant active, nobody unmapped); then `TENANT_ROUTING_ENABLED=true` and `TENANT_HOST_SUFFIX=.devzone.stellreducation.org` live on `stellr-web-dev`, with `NEXT_PUBLIC_APP_ENV` present for `dev`, and health showing `tenantRouting.suffixError` null; only then the DNS records and the attach.
3. Test in a dedicated browser profile, or a fresh private window, that never signs in to production www or app. After K9, sign the persona sessions out and clear the `stellreducation.org` cookies in that profile.
4. No `dev` or tenant-tree code writes a `Domain=.stellreducation.org` cookie without review. On this zone, anything `dev` writes at the parent domain is read by production.
5. `dev` email that carries canary-host links goes only to test inboxes and the canary personas.
6. Keep the `robots.txt` Disallow and the noindex on tenant hosts, do not add the hosts to Search Console, and confirm 0 tracker requests on the canary host in K9 Phase B.
7. Rollback: detach both domains in Vercel first, then delete the two CNAMEs at GoDaddy, then remove the flag and suffix and redeploy the newest READY deployment.
8. Before production's `TENANT_ROUTING_ENABLED` flip (not before K6): the production zone guard (`W7-27`) in `tenantRoutingConfig`, and the canary runner refusing every host under `.events.stellreducation.org`, on production. Both are built (below) and on production since #680 (14 Nov 2026 UTC).

**The canary hosts are public for the K9 window.** A custom domain on `stellr-web-dev`'s production target is outside Standard Deployment Protection. The owner accepted that for the K9 window on 13 Nov 2026 (`W7-25`): the hosts serve the tenant tree only, allow-listed pages, and `dev` data.

### The K6 steps

Results are recorded with hostnames, status codes and header names only.

0. **The `dev` database.** Run the K3 flow seed with `--zone devzone.stellreducation.org` (`scripts/seed-two-tenants.ts --profile flow`, dry run, then `--apply --clerk`, then `--check`). Confirm `tenant_domains` maps `canary.devzone.stellreducation.org` to the active `dev-canary` tenant and has no row for `nobody.devzone.stellreducation.org`. Keep Phase A's `canary.localhost` row as well, so Phase A can be re-run locally (`W7-31`).
1. **`stellr-web-dev` only** (its production target builds `dev`). Claude, with the Vercel CLI and the owner's yes: set `TENANT_ROUTING_ENABLED=true` and `TENANT_HOST_SUFFIX=.devzone.stellreducation.org`, check that `NEXT_PUBLIC_APP_ENV` exists for `dev` without printing it, and redeploy the newest READY deployment.
2. **The deployment took it** (`W7-19`): READY for the expected commit. As an admin on the `stellr-web-dev` deployment, `GET /api/admin/health/integrations`: `tenantRouting.enabled` true, `tenantRouting.suffixError` null. The `stellr-web-dev*.vercel.app` pages answer as before.
3. **Vercel, `stellr-web-dev`, Settings, Domains:** add `canary.devzone.stellreducation.org` and `nobody.devzone.stellreducation.org`, with no redirect, on the production branch. Copy the DNS target Vercel shows for this project; do not assume it is the one www uses. If it asks for a `_vercel` TXT ownership record, copy that too.
4. **GoDaddy** (DNS for `stellreducation.org`; the owner adds the records, `W7-30`): add exactly a CNAME `canary.devzone` and a CNAME `nobody.devzone` to the Vercel target, and the TXT record only if Vercel asked for it. Use a low TTL (600 seconds, or the minimum). Add nothing for `devzone` or `*.devzone`, and do not touch the apex, www, app, clerk, accounts, mta-sts, mail, SPF, DKIM or DMARC records.
5. **Wait** until Vercel shows a valid configuration and has issued certificates for both hosts.
6. **Straight away:** `host canary.devzone.stellreducation.org` and `host nobody.devzone.stellreducation.org` resolve to Vercel; `host zz.devzone.stellreducation.org` and `host devzone.stellreducation.org` stay NXDOMAIN. `curl -sI https://nobody.devzone.stellreducation.org/` answers 404 with `X-Robots-Tag: noindex` and no `Set-Cookie`. If not, detach now.
7. **The mapped host:** `curl -sI https://canary.devzone.stellreducation.org/` answers 200 with the neutral page and an enforcing CSP; `/admin`, `/community` and `/home` answer 404; `/robots.txt` answers `Disallow: /`; no Stellr marketing renders. If the Stellr site appears, detach now.
8. **Production unchanged:** `https://www.stellreducation.org/` and `https://app.stellreducation.org/` answer as before, with the same status, headers and `Set-Cookie` names.
9. **In the dedicated browser profile on the canary host:** 0 requests to GTM, GA, HubSpot or Vercel Insights; no hydration error; 0 CSP violations. Sign in with Clerk (dev instance, Turnstile) and record the `Domain` attribute of `__client_uat` and `__client_uat_<suffix>`. Whether the Clerk dev instance needs the canary host in its allowed origins, redirect URLs or bot-protection domains shows here; add only what is needed, with the owner's yes (`W7-29`). Then run K8's Phase B: `--zone devzone.stellreducation.org --base https://canary.devzone.stellreducation.org`, with `--stellr-base` the `stellr-web-dev` deployment.
10. **Record the results** in the canary record (`docs/TENANCY-S5.md`, "Docs owed after wave 7"). Teardown or rollback, in this order: detach both domains in Vercel; delete the CNAMEs (and the TXT) at GoDaddy; remove `TENANT_ROUTING_ENABLED` and `TENANT_HOST_SUFFIX`; redeploy the newest READY deployment and run the deployment check.

### The production zone guard (`W7-27`)

**Built and on production** (approved 13 Nov 2026 as a small wave 7 slice, #675; promoted in #680, `fba19669`, 14 Nov 2026 UTC). It was a hard gate before production's `TENANT_ROUTING_ENABLED` flip: it had to be on production first, and now is.

- **One constant.** `PRODUCTION_TENANT_ZONE` (`.events.stellreducation.org`) in `lib/tenancy/host-pure.ts`, with `isInProductionTenantZone(host)` (the zone apex or any host under it). `lib/tenancy/host.ts` re-exports it. `scripts/canary/tenant-host-headers.mjs` is plain JavaScript and holds a copy, which its test holds equal.
- **`tenantRoutingConfig`.** On the real production app (`isRealProductionApp()`), only `PRODUCTION_TENANT_ZONE` is accepted; any other suffix sets `suffix` to null and `suffixError` to "`TENANT_HOST_SUFFIX` is not the production tenant zone; …". A `.localhost` or `.test` zone keeps its own reason ("a development zone on production"). Off production (local runs, previews and `stellr-web-dev`, which declares `NEXT_PUBLIC_APP_ENV=dev`), the production zone and any zone under it are refused: "`TENANT_HOST_SUFFIX` is the production tenant zone, which is refused off production; …". The earlier rules (an unsafe suffix; routing on with no suffix) are unchanged. Either refusal fails closed like any unusable zone: known Stellr hosts keep working and every other host answers 503. The reasons are fixed text and never name the zone.
- **Health.** `GET /api/admin/health/integrations` shows the reason as `tenantRouting.suffixError`, and the switch registry (`lib/tenancy/flags.ts`) lists `TENANT_HOST_SUFFIX` as unrecognised and, with routing on, `routing_without_usable_suffix`. The registry needed no change: its check calls `tenantRoutingConfig`.
- **The canary runner.** `canaryBases` (`lib/testing/canary-flow-scenarios.ts`, used by `scripts/canary-tenant-flow.ts`) and `originOf` and `canaryHostFor` (`scripts/canary/tenant-host-headers.mjs`) refuse any `--base` or `--stellr-base` in the zone, its apex included, and the zone itself as `--zone`, from the flags alone. Each CLI prints "refusing: … the production tenant zone …" and exits 1 before any request or read.
- **Tests.** `lib/tenancy/host.test.ts` (both directions on and off production, every earlier reason unchanged, fail-closed resolution, `isInProductionTenantZone`); `lib/tenancy/flags.test.ts` (the registry's view); `app/api/admin/health/integrations/route.test.ts` (health, never echoing the zone); `test/proxy-tenant-routing.test.ts` (no database call on a Stellr host under either zone); `lib/testing/canary-flow-scenarios.test.ts` and `scripts/canary/tenant-host-headers.test.ts` (the refusals, and both CLIs run against a listener on this machine: exit 1, 0 requests). Tests that route under the production zone now run as the real production app.

### Still open

No owner question from the cookie review is open: `W7-25` to `W7-31` were answered on 13 Nov 2026 (`docs/S5-DECISION-REGISTER.md`). What remains are steps, each with the owner's yes at the time:

- K6 steps 0 to 8 on `stellr-web-dev` and the `dev` database, with the owner adding the two CNAME records at GoDaddy (`W7-30`).
- K6 step 9, in K9: record the `Domain` attribute of both `__client_uat` cookies, and add to the Clerk dev instance only what sign-in shows is needed (`W7-29`). Then K8's Phase B.
- After K9: decide whether the dev zone stays under `stellreducation.org` or moves to a separate domain (`W7-28`).
- Before production's routing flip: the no-ads question again before a production tenant zone under `stellreducation.org` (`W7-26`). The production zone guard (`W7-27`) is on production since #680.

## Gates

| Gate | Proof | Status |
|---|---|---|
| Flag off changes nothing on Stellr hosts | `test/proxy-tenant-routing.test.ts`; B10a's body hash over all pages | Built: test, and B10a (#563, on production via #587) |
| Flag on adds no database call on a Stellr host | same test | Built |
| Forged headers change nothing, the tree 404s by every spelling | same test; B10(c) on the production build | Built: test, and B10 (#578, on production via #587). B10(c)'s Stellr-host rows are checked by a person at sign-off |
| Warm-cache hash per tenant | B10(b), with two non-owner tenants | Not built |
| 0 trackers on tenant hosts | `test/tenant-tree-no-analytics.test.ts`; B10(d) in a browser | Test and B10 built (#578). B10(d) in a browser on a hosted canary host: not run (K9 Phase B) |
| 0 community routes on tenant hosts | `test/tenant-surface-routes.test.ts`; B9 | Built: the allow-list, and B9 (#578; its CHECK applied to `dev` and production on 9 Nov 2026) |
