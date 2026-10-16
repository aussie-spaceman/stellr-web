# Handover: mobile and tablet review, Phases 0–4 (15–16 Oct 2026)

Tracker: `tracker/2026-10-16-mobile-review.md` (rows `mobile-review.1–12`).
Review: a private Artifact with 49 findings, a five-phase plan and decisions
D1–D5 (https://claude.ai/artifact/TBCQfaWrW3Y712V8bgKvC8). Its status section
is kept current with the results below.

## Context

On 15 Oct David asked for a full review of the public site and the web app,
focused on phones and tablets. It covered load times, rendering, orientation,
and design and code standards, and ended with a plan. The review found 49
issues in seven areas: event day, speed, layout, touch and forms, the member
app and admin on small screens, accessibility (WCAG 2.2 AA), and code
guardrails. Two were urgent:
- **Video rooms:** they couldn't use the camera or microphone in Chromium. The
  empty `Permissions-Policy` allowlist from #273 denied the Jitsi iframe.
- **Event check-in:** it wasn't ready for phones before Nevada (6–7 Nov).

David agreed D1–D4. For D5 he said every marketing tag is still in use. He asked
for Phases 0–4 to be built, "to fix every single finding".

## What changed

| PR | What | State |
|---|---|---|
| #426 → `dev` `1f48d7d6` | Phase 0: video-room `Permissions-Policy` for the Jitsi origins on the three room routes only; check-in pages in an `app/(flow)` group with a slim header; console polling, offline queue and desk mode; every measured sideways scroll fixed; 16px fields on touch; the `@stellr/web-ui` field primitives; Playwright `mobile-320`, `mobile-chrome` and `mobile-safari` overflow checks in CI | Merged |
| #427 → `dev` `7e53fcee` | Phases 1–3: no Clerk JS for anonymous visitors; ISR and cache tags on public pages, with `/api/webhooks/sanity` to expire them; the shared `Dialog`; "More" sheets for the app and admin sidebars; the cookie banner server-rendered; one toast live region; `app/manifest.ts`; tables scroll with a sticky first column | Merged |
| #428 → `dev` `e4ab53ca` | Phase 4: every form on the field primitives; AA contrast retune of the tokens, with `design/contrast-gate.mjs` in `build:tokens`; fluid type tokens and a 12px floor; `lint:ci` (jsx-a11y + Next rules, ratchet `--max-warnings 42`); ds-lint ratchets (`scripts/ds-lint-baseline.json`); the axe ratchet `e2e/mobile/axe.spec.ts` with an empty baseline; the Storybook story check `npm run test:storybook` | Merged |
| #429 → `dev` `0ab624d7` | The e2e survey fixture no longer grants the seeded minor's credential consent (a race with the credentials spec) | Merged |
| #430 `dev` → `main` `d4661b56` | Promotion of #426–#429, 16 Oct 14:58 UTC. Production deployment `dpl_dDfgTsRKYUtwTq8c97rEL9p47FGL`, then redeployed as `dpl_t9jBAeGpi7QYYC1txRW53Bkq3wcZ` (same commit) to pick up the new env variable | Live |
| #431 → `dev` `ac615996` | Promotion record `.claude/releases/promote-2026-10-15b.md` | Merged |

No migrations. CI config changed: `.github/workflows/ci.yml` installs WebKit and
runs the mobile projects.

Outside the repo, 16 Oct:
- **HubSpot:** the Google Ads pixel was removed (Settings → Marketing → Ads →
  Pixels). It was the only pixel there. It loaded a second, bare
  `gtag/js?id=AW-10893614207` (166 KB) on every page through
  `js.hsadspixel.net`. HubSpot's confirmation said it fed 0 website audiences
  and 0 conversion events. The ad account connections and auto-tracking are
  unchanged. This was decision D5. The review had put the duplicate in GTM; a
  CDP initiator trace showed it came from HubSpot.
- **Vercel** (David): `SANITY_REVALIDATE_SECRET` was added to `stellr-web` and
  `stellr-web-dev`, Production scope, and Web Analytics was enabled.
  Speed Insights needs Vercel Pro, so it is off.
- **Sanity** (David): the webhook "Stellr" (`6T2uds0tXrV5NHff`) was created,
  with create, update and delete, `POST`, dataset `production`, drafts off, and
  the same secret, pointing at `https://www.stellreducation.org/api/webhooks/sanity`.

## How it was verified

- **CI:** each PR's run was checked by step outcome, with the run's `headSha`
  matched to the PR head.
- **Production, after #430** (anonymous visitor):
  - 31 of 44 sitemap routes are cache HITs (before: 0); event pages HIT from
    their second visit.
  - 0 Clerk requests (before: 80 requests, 306 KB).
  - No page wider than the screen on a Pixel 7; `/network` was 541px too wide.
  - axe clean at 375px on the 20 smoke routes.
  - Mobile Lighthouse performance 80–92 on `/`, `/events`, `/competitions`,
    `/curriculum` and `/membership`, up from 53–63.
- **Duplicate Ads library:** with ads consent stored, `/` and `/events` load
  `gtag/js?id=AW-10893614207` once, GTM's copy (`&cx=c&gtm=…`), and its
  conversion ping. Without consent, Google loads GTM and GA4 only, and
  `hsadspixel` doesn't load at all.
- **Sanity webhook**, after the production redeploy:
  - An unsigned POST returns 401 (before: 500, "not configured").
  - A throwaway `webhookTest` document was created and then deleted through the
    mutate API. The webhook's attempts log shows two deliveries, each 200
    `{"revalidated":true,"type":"webhookTest"}`.
  - The next request to `/events` returned `x-vercel-cache: REVALIDATED` with
    `age: 0`.

## Not verified, and gaps

- **Signed-in pages on production** (row `.2`). There are no production test
  accounts. The member app and admin were exercised on dev and in CI only.
- **Real devices** (rows `.3`, `.4`). Phone check-in from the door QR, the
  console on a tablet, and a video room on Android. Headless Chromium can't
  prove the camera permission.
- **Dev has no secret yet** (row `.5`). Three redeploys of `stellr-web-dev`
  rebuilt the newest row, the docs-only #431 commit, and
  `scripts/vercel-ignore-build.sh` cancelled each one. The route there still
  returns 500. The first redeploy followed this session's own instruction
  ("redeploy the current production deployment"), which was wrong for dev.
  Each cancelled build still counts toward Hobby's deployments a day.
- **Web Analytics** (row `.8`): `/_vercel/insights/script.js` returns 200 on
  production, but no data has been seen in the dashboard.
- **Speed Insights** (row `.9`): this session's instructions assumed it was
  available on Hobby. It isn't.
- **"Every finding" is fixed in code, with three exceptions:**
  - The code-standards findings became ratchets, not zero (row `.10`).
  - One Storybook story is skipped (row `.11`).
  - Two e2e tests still flake (row `.12`).

## Things the next session should know

- **Local e2e must mirror CI.** Use one origin (`NEXT_PUBLIC_SITE_URL` and
  `NEXT_PUBLIC_AUTH_APP_URL` both `http://localhost:3000`) and a per-run
  `ESIGN_TOKEN_SECRET`. Otherwise about 14 false failures hide the real one.
- **ClerkProvider `prefetchUI={false}`** removes the prebuilt components, and
  `UserButton` then crashes the page. #427 dropped the flag. Anonymous
  visitors still load no Clerk JS, because the nav reads the `__client_uat`
  hint first.
- **Storybook's test-runner doesn't work with Storybook 10** (Jest refuses
  `module.register`). The story check is Playwright instead
  (`playwright.storybook.config.ts`). A component that calls `usePathname`
  needs `@storybook/nextjs/navigation.mock`.
- **Tailwind `short:`** is `'@media (max-height: 500px) { :root & }'`, because
  plugin variants sort before the breakpoints.
- **To read Sanity webhook deliveries,** call
  `GET https://api.sanity.io/v2021-10-04/hooks/projects/if8ubvbg/<hook id>/attempts`
  from a signed-in sanity.io page with `credentials: 'include'`. Webhooks fire
  only on a document change.
- **HubSpot's pixel "Remove" button shows only while the row is hovered.**
