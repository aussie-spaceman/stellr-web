# Handover — Check-in banner — 15 Oct 2026

Slug `check-in-banner`. Tracker: `tracker/2026-10-15-check-in-banner.md`.
Builds on check-in v2 (`HANDOVER-event-check-in-v2-2026-10-08.md`). Staff steps: `docs/RUNBOOK-event-check-in.md`.

## Context

David's user stories:

- **Participant:** arrive at the registration desk, scan one QR code, land on the name + date-of-birth screen, check in.
- **Admin:** one banner that can travel to every event and be reused, whichever event is open.

At most one event is open at a time.

David's decisions (asked and answered in session, 15 Oct):

| Question | Decision |
|---|---|
| What decides "the open event" | The desk console's **Open check-in** switch (`event_settings.check_in_open`), not Sanity's `registrationOpen` |
| A stale event left open | Opening an in-person event's check-in **closes any other** in-person one |
| What the QR code holds | The **plain short URL** `stellreducation.org/check-in`, with no key |
| What admin needs to make the banner | **QR files for a designer** (SVG + PNG), not a printable layout |

## What shipped

- **#422 → `dev` as `e93281b6`. Promoted in #423 (`4545b3a7`, 15 Oct 17:50Z) by a separate session.** The promotion record is `.claude/releases/promote-2026-10-15.md`. It gives production deployment `dpl_DX2oTQL5Q2D48VJEiqUq2zPsRh2w` and rollback target `dpl_rwdHtVjizUyhfvU2Uqj9rFg8tpVh`.
- **No migration.**

| Area | Files | What |
|---|---|---|
| Resolver | `lib/check-in-banner.ts` (+ test) | `loadOpenCheckIns` reads `event_settings` where `check_in_open`, joined with Sanity `setting`/dates via `getEventsBySlugs`. `pickBannerEvent` drops virtual events, slugs with no Sanity doc and rows with no token. If two are open, the one nearest today (UTC) wins, then slug order |
| Banner address | `app/(public)/check-in/page.tsx` | `redirect()` 307 to `/check-in/<slug>?t=<token>`, `force-dynamic` (`no-store`). Never a 308, which phones cache. None open: "Check-in isn't open yet", sends people to the desk. Noindex, and in `STATIC_ROUTE_EXCLUSIONS` in `app/sitemap.ts` |
| One event at a time | `app/api/admin/events/[slug]/check-in/route.ts` (+ test) | `open` on an in-person event sets `check_in_open = false` on every other in-person event and returns `closed`. Opening a virtual event touches nothing. GET also returns `bannerTarget` and `otherOpen` (it catches its own errors, because the console polls every 5 s) |
| Desk console | `components/admin/CheckInLive.tsx`, check-in page passes `isVirtual` | Confirm before closing another event; "The check-in banner points here" badge; **Banner** button; new help copy |
| Banner page | `app/(admin)/admin/competitions/check-in-banner/page.tsx`; link on the competitions list | `requireEventAccess()` (admins + event managers). Shows where a scan goes now, SVG + 3000px PNG (error correction Q, 4-module quiet zone) and designer notes. Warns when `isRealProductionApp()` is false, because the QR code then encodes that host |
| Sanity | `lib/sanity.ts` | The existing `getEventsBySlugs` also fetches `endDate`, `setting` |

## Verified (and how)

- **Unit tests:** 8 new (resolver) + 6 new (route).
- **Locally:** the full suite caught one failure (the sitemap guard), fixed in the PR. `tsc`, `lint:tokens` and `lint:pii` are clean.
- **CI on #422:** every step's outcome was read, not the badge:
  - `verify`: PII lint, typecheck, design-system lint, unit tests and build all succeeded.
  - `e2e`: `playwright test` succeeded.
- **Browser, local server against dev data,** signed-in admin through the repo's Playwright auth. Event rows were put back afterwards (closed, token null):
  - nothing open → `/check-in` 200 with the not-open page;
  - opening Colorado → 307 to Colorado's form;
  - opening Nevada showed the confirm naming Colorado; Colorado then read Closed and `/check-in` went to Nevada;
  - a phone-sized browser landed on Nevada's name + DOB form;
  - the banner page showed Nevada as the target;
  - the downloaded PNG is byte-identical to the QR encoding of the banner URL.
- **Production, by curl (15 Oct, after #423):**
  - `/check-in` → 307, `cache-control: private, no-cache, no-store`, so the new code is live;
  - the apex keeps the path (308 to www);
  - `/admin/competitions/check-in-banner` signed out → 307 to sign-in, so the route exists.

## Not verified / known limits

- **Production still has Colorado's check-in open** (prod `event_settings` read 15 Oct). The live banner address sends every scan to Colorado. Because the address is public, it also gives Colorado's check-in code to anyone who visits. Row `.1`.
- **No one has opened the banner page signed in on production,** and the production QR files have never been downloaded. They should encode `https://www.stellreducation.org/check-in`; this is unconfirmed. No real camera has scanned a printed banner. Row `.2`.
- **Desk console confirm and badge** have been seen on dev data only, not on production.
- **Event managers:**
  - Opening their event's check-in closes any other in-person event, including one they don't manage.
  - The banner page uses section-level access.
  - Tested as an admin only. Row `.4`.
- **Sanity reads are cached for an hour** (`PUBLISHED_CACHE`). A change to an event's setting or dates can take up to an hour to reach the banner. The open/close switch takes effect at once.
- **No e2e spec touches `/check-in`** (also `event-check-in-v2.6`).
- **The premise of `event-check-in-v2.8`** ("token-gated, at the venue") no longer holds: the token is one public redirect away while check-in is open. Row `.6`.

## Open items

`tracker/2026-10-15-check-in-banner.md`, rows `check-in-banner.1` to `.7`.
