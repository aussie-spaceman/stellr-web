# Tenant routing: runbook

How a request on a tenant host reaches the app, what fails closed, how to classify a new route, and how to turn routing on and back off. Built by B1, B2, B5 and B7. Plan of record: `docs/TENANCY-S5.md`. Code wins over this file; if they disagree, fix this file.

## Where it stands

`TENANT_ROUTING_ENABLED` defaults to off, and nothing in this work sets it. With it off, the tenant branch in `proxy.ts` is one string comparison. Attaching a real zone is an owner gate that has not happened.

**Tenant hosts are not ready to serve anyone.** Every one of these has to pass before a real zone gets the flag:

| Needs | Because |
|---|---|
| B5b | Without it, all 16 `app/(flow)` pages 404 on a tenant host |
| B5c, B10(d) | `app/layout.tsx` still wraps the tree, with Stellr's metadata and the `ConsentMode` head script |
| A7, C6's cap at 0, B10(c) | The under-14 API gate, and tenant checks on token and slug lookups. Allowed routes read by global id until then |
| B6 | The CSP is still Report-Only |
| B8, B9 | Import-closure lint and the community CHECK. The allow-list already denies community routes |
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
| Clerk's own cookies | Set by Clerk | **Not checked.** Session sharing across the zone is part of the same gate |
| GTM and HubSpot cookies on www and app | Set by those scripts | **Not checked.** Read them from a real browser during the review |

**The no-ads gap.** A student who signs in only on a tenant host is not marked for Stellr's www in that browser, so if advertising was previously accepted there, www can grant it. Privacy Policy section 9.4 promises otherwise. Either accept and record it, or have a tenant-tree server action or a small non-analytics module set the fixed bit for zone hosts under `stellreducation.org`. A tenant on a custom domain could not share the cookie either way.

## Bypasses on a tenant host

- `public/` assets, the webmanifests and `/api/img` stay Stellr-branded. The webmanifests pass through as static files.
- The unscoped `next.config.mjs` redirects fire before the allow-list. Next applies them ahead of the proxy.
- The tree's metadata is neutral (`Event site`, noindex), but the root layout's is not, until B5c.

## Turning it on

Owner only. On `dev` first, then production, one Vercel project at a time. On each:

1. Create the `tenant_domains` rows and confirm the tenant is `active`. Do not attach anything yet.
2. Set `TENANT_ROUTING_ENABLED=true` and `TENANT_HOST_SUFFIX`, and redeploy the newest READY deployment.
3. Read `GET /api/admin/health/integrations` as an admin. `tenantRouting.suffixError` must be null. It never shows the zone itself.
4. Confirm www and app answer as before.
5. Attach the wildcard domain.
6. **Straight away,** check that an unknown host in the zone answers 404. Detach if it does not.
7. Check a mapped host: `/` answers the neutral page, `/admin` and a community path answer 404, and an allowed page renders.

**Why this order.** With the flag off, the resolver says Stellr and `proxy.ts` compares the host only to `APP_HOST`, so a tenant hostname would get the full Stellr surface: `/admin`, community and trackers. The same happens if the suffix does not cover the zone. Never attach a zone before the flag and suffix are live and confirmed.

## Rolling it back

1. **Detach the zone first.**
2. Then remove the flag and redeploy the newest READY deployment.

Flipping the flag first exposes the zone to the Stellr surface until the domain is gone. To suspend one tenant, set its status: its hosts turn to 404 within 2 minutes per instance.

## Gates

| Gate | Proof | Status |
|---|---|---|
| Flag off changes nothing on Stellr hosts | `test/proxy-tenant-routing.test.ts`; B10a's body hash over all pages | Test built. B10a not built |
| Flag on adds no database call on a Stellr host | same test | Built |
| Forged headers change nothing, the tree 404s by every spelling | same test; B10(c) on the production build | Test built. B10 not built |
| Warm-cache hash per tenant | B10(b), with two non-owner tenants | Not built |
| 0 trackers on tenant hosts | `test/tenant-tree-no-analytics.test.ts`; B10(d) in a browser | Test built. B10 not built |
| 0 community routes on tenant hosts | `test/tenant-surface-routes.test.ts`; B9 | Allow-list built. B9 not built |
