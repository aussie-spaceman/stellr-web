# Handover: Vercel Active CPU, apollo-reconcile and Stripe follow-ups (21–22 Oct 2026)

Slug `vercel-active-cpu`. Tracker: `tracker/2026-10-22-vercel-active-cpu.md`.
Committed and on `dev`: #451 as `94e4b756`, #452 as `4b11faac`. **Not promoted at close-out.** Promotion PR #454 (#453, #451, #452) was open with e2e running; a separate session is driving it. Nothing here saves CPU until #454 is in production.

## Context

On 21 Oct Vercel emailed that the Hobby team `stellreducation` had used 75% of its 4 hours of Fluid Active CPU. At 100% Hobby **pauses every project in the team**: www, app and the connectors. By that evening the Usage page read 3h 36m (90%). The page offers only "Last N days" ranges, so the meter is treated as a rolling 30-day total. Recent days run about 5 minutes; busy days have reached 15–19.

Split, from Usage: stellr-web 3h 10m, stellr-web-dev 26m, web-gate-connector 27s. **By type: functions 2h 17m, middleware (`proxy.ts`) 1h 19m.**

## Diagnosis

From stellr-web Observability → Functions (the last 12 h, per route), plus 12 h of CDN request records:

- **ISR pages re-rendering every minute.** `/` cost 21 s for 56 renders (~375 ms each); event pages 12 s; segment prefetches of the same pages ~13 s. `lib/tier-pricing.ts` and `lib/event-pricing.ts` cached Stripe prices with `unstable_cache({ revalidate: 60 })`. Inside an ISR page that value becomes the **page's** window (Next 16.4, `unstable-cache.js`), so the 1 h `revalidate` on those pages was really 60 s. Live, the priced pages were STALE while `/donate`, `/events` and `/privacy` were HIT.
- **Prefetches of dynamic pages.** The admin rail, member-table rows, competition tabs, the member-app rail, the event-card Register button and `/grant` links each rendered their target on the server whenever they came into view.
- **The Studio slug check.** Sanity re-runs every validator on each edit, so editing any event field called `/api/admin/events/slug-guard` (115 calls in 26 minutes).
- **The manifest** read `headers()`, so every fetch was a function run.
- **The proxy** runs on Node for every matched request, cached or not, including each `/api/img` URL a gallery page loads. It is 37% of the meter; most of that is the fixed cost of running on every marketing page view, which only Phase 3 removes.
- Bots (~4% of calls), the dev project and the connectors are not the cause.

## What changed

**#451 → `94e4b756`**
- Both price caches use an hour (`PRICE_CACHE_SECONDS`); tests pin the window and the tags.
- `lib/price-cache.ts` holds the two cache tags, the Stripe events that can change a displayed price, and `revalidatePriceCaches()`. The Stripe webhook calls it on `price.created/updated/deleted` and `product.updated`. **The live endpoint is not subscribed to those events** (`.3`).
- `prefetch={false}` on: `AdminSidebar`, `AppSidebar`, `MemberTable` rows, the competitions list and detail tabs, `EventCard`'s Register link, and the `/grant` links in the navbar, footer, `/educators` and the engineering-design guide. Navbar and footer items take an optional `prefetch: false` field.
- `sanity/schemas/event.ts`: the slug check reads the published slug through the Studio's own client (perspective `published`, as on the server) and calls the API only when the slug really differs. Both lookups are cached for 60 s.
- `app/manifest.ts` is static (`lib/web-manifest.ts`). The member app's variant is a force-static route, `app/app.webmanifest`, which a host-scoped `beforeFiles` rewrite in `next.config.mjs` serves at `/manifest.webmanifest` on the app host.
- `proxy.ts`'s matcher skips `/api/img`; `test/proxy-matcher.test.ts` pins it.

**#452 → `4b11faac`**
- Prod `cron_runs` showed every `apollo-reconcile` run from 13 to 21 Oct unfinished. Apollo returns 110 engaged prospects in ~2 s, then each costs ~4–5 HubSpot calls plus a 300 ms pause (~1.3 s), so a run needs ~140 s against `maxDuration` 60. Vercel killed it around prospect 45 every day: nothing recorded, no alert, and the rest never reconciled.
- `reconcileProspects` takes a `deadline` and returns `stoppedEarly` and `nextOffset`. The route stops starting prospects at 40 s and resumes from the last finished run's `result.nextOffset` (`lastCronResult` in `lib/cron-runs.ts`; no migration). A failed run writes its cursor back. Prospects are sorted by email so the index is stable. About 30 per run, so a full lap takes ~4 days.

**Outside the repo**
- Cron Jobs disabled on `stellr-web-dev` (`.6`).
- A legacy Stripe Payment Link created outside the app was being abused; deactivated on David's yes (`.10`).

## Verified

- CI on #451's final commit and on #452 after updating it with `dev`: every step `success`; Playwright 169 and 168 passed, Storybook 39. #452's run had one flaky retry in `e2e/core/survey.spec.ts` (certificate gate), which it does not touch.
- Local build: `/`, `/competitions` and `/membership` build at 1 h; both manifests build static.
- #451's dev deployment serves `/manifest.webmanifest` as a static file.
- Stripe (read-only in the dashboard): which events the live endpoint receives, the enabled payment methods, and that no delayed-payment event exists in the retained history.

## Not verified

- Anything in production (`.1`), and so the meter (`.2`) and the cron (`.5`).
- The Stripe price refresh, which is inert until the endpoint is subscribed (`.3`).
- Prefetch-off clicks (`.7`), the Studio slug check in a real Studio (`.8`), the app-host manifest (`.9`).

## Gotchas

- **Hobby's metrics live only on the signed-in dashboard.** `vercel metrics` returns 402 and the MCP observability schema 404. Usage → Fluid Active CPU (with the Type tab) and the project's Observability → Functions page (12 h, per route) both work on Hobby. `vercel logs requests --since 719m` gives 12 h of CDN records with `pathType` and `cacheResult`.
- **Never shorten a cache window inside an ISR page without checking the page.** `unstable_cache`'s `revalidate` sets the page's window.
- `test/route-guards.test.ts` requires `guardCron` to be a cron's first statement.
- `unstable_doesMiddlewareMatch` from `next/experimental/testing/server` tests the proxy matcher.
- Auto mode refused `gh pr merge` on this session's own PR after a button reply, but allowed it after David invoked `/ship`.
- A merge into `dev` restarts an open promotion's CI, so this close-out PR waited for #454.
