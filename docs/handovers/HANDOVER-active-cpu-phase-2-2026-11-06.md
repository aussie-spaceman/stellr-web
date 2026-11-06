# Handover: Active CPU phase 2 (5–6 Nov 2026)

Slug `active-cpu-phase-2`. Tracker: `tracker/2026-11-06-active-cpu-phase-2.md`.

**Merged to `dev` as `e866125a` (#556). Not promoted: nothing here is in production, so the meter won't move yet.** At close-out the dev deployment was still building and CI on the dev push was pending.

## Context

Vercel emailed on 4 Nov that the Hobby team had used 75% of its 4 hours of Fluid Active CPU, the second such email. The Usage overview read 3h 8m (78%) on 5 Nov. At 100% Hobby pauses every project. 4 h over a rolling 30 days is 8 min/day, and 2–5 Nov averaged about 8.4, read off the chart. Weekends run about 3–4.5.

October's Phase 1 worked (`/` fell from 56 renders per 12 h to 6), but middleware stayed at 1h 17m (39%).

## Diagnosis

From the Usage page, 12 h of Observability → Functions and 12 h of request records:

- **The proxy runs on every prefetch.** One homepage view sent 16 prefetches. Most came from page content and the logo and Donate links, not the nav dropdowns, which render links only while open. About 4,400 proxy runs a day at about 35 ms each (derived from invocation totals, not measured per path).
- **`/api/img` is the top function** (25 s per 12 h; 115 misses of 153). Each image has about 4 widths, cached per region.
- **Hourly ISR re-renders** (about 28 s per 12 h; 126 revalidations, 44 on event pages).
- **The check-in desk polled every 5 s**, each poll a function and a proxy run. Cost per poll was not measured.

Not the cause: crons, bots, the dev project, `web-gate-connector`.

## What changed

- `components/ui/SiteLink.tsx` is next/link with prefetch off. Public pages and everything they import use it; `test/public-no-prefetch.test.ts` walks the import graph.
- `proxy.ts` skips `/_vercel/` by exact path.
- `lib/watermark/image.ts` renders only the corner and caches it per size. `/api/img` encodes WebP at q75, effort 2.
- `/api/img` sends `Cache-Control: public, max-age=86400`, `Vercel-CDN-Cache-Control: public, max-age=31536000` and `Vercel-Cache-Tag: sanity-image-<hash>`. Removal steps are in `docs/RUNBOOK-privacy-retention-and-deletion.md`, Part C.
- `components/admin/CheckInLive.tsx` polls every 10 s. Taps and scans already synced at once.
- `ChatPanel` and `ChannelFeed` stay at 8 s and pause in hidden tabs, reloading on return.
- Public pages, `PUBLISHED_CACHE` and both price caches use 6 hours. They must move together: the shortest window sets the page's.
- `docs/RUNBOOK-vercel-pro.md`: batch promotions, with security, child-safety and secret-rotation exemptions; Pro at a sustained 85%.

## Security and minors decisions

These change the first set of recommendations. Keep them if this work is revisited.

- **No matcher skips by extension.** `.txt` or `.xml` rules would let `/admin/x.txt` or `/credentials/x.txt` past the admin check, rate limit and private-route header. #553 separately makes gated prefixes always run the proxy.
- **`/robots.txt` and `/sitemap.xml` stay in the proxy.** `lib/tenancy/tenant-surface.ts` classifies them as denied on tenant hosts, and they are only about 4% of runs.
- **Never use a `next-router-prefetch` `missing` matcher.** A client can set that header, and the proxy gates `/admin`.
- **Marketing pages stay in the proxy.** Without the region cookie, `HubSpotTracking` treats UK and EEA visitors as non-strict, so tracking could load without prior consent. The proxy also applies CSP and strips client-sent tenant headers.
- **Chat stays at 8 s.** `ChatPanel` realtime announces inserts only, so a moderator's delete reaches other members through the poll.
- **No public Blob for stamped photos.** Those URLs are open to anyone with the link and would outlast a removal request.
- **6 hours, not 24.** The Privacy Policy promises removal at any time; if the publish webhook fails, this window bounds how long removed content stays up.

## Verified

- CI on the final PR commit: every step passed, including `unit / Unit tests`, `e2e-tests / Run npx playwright test`, `e2e-local / Run npx playwright test` and `verify-build / Build`.
- Production build on localhost before the last merges of `dev`: homepage prefetches 0 on load and after scrolling; a link click navigates client-side; `/api/img` headers as above; the corner crop shows a legible mark with no EXIF.
- The build lists public pages at 6h.

## Not verified

- Anything on a deployment: the CDN headers and whether the CDN actually honours them (`.4`), and delete-by-tag (`.5`).
- The CPU savings, estimated at about 2 min/day (`.6`). The local watermark benchmark ran on a Mac with an earlier variant, and it excludes fetch and cold start.
- That the CDN clears on each deploy. That came from memory; the docs search did not confirm it.
- Any delivery of the Sanity publish webhook (`.2`).
- `ChannelFeed`'s hidden-tab pause has no test of its own; `ChatPanel`'s does, and the code is the same. `POLL_MS` has no test.

## Gotchas

- The permission system refused the live Stripe endpoint write. Don't route around it (`.1`).
- `SANITY_API_TOKEN` lacks `sanity.project.webhooks/read`.
- `vercel logs requests` records hold private-link tokens in `requestPath`. Keep only `route` and similar fields, and don't write the raw records to disk (`.7`).
- Two tests pin the routes the proxy may skip (`test/proxy-tenant-routing.test.ts`, `test/tenant-surface-routes.test.ts`). They are a deliberate review point, not something to edit past.
- Prefetching only happens in production builds, so measure with `next start`, not `next dev`.
- The Nevada freeze was set aside on David's instruction for this build.
