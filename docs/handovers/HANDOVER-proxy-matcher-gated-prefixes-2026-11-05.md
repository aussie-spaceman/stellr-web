# Handover: proxy.ts matcher gated prefixes, 5 Nov 2026

**Not promoted.** #553 is on `dev` as `15071aed`, and promotion runs in a separate session. No migration. Open items are in `tracker/2026-11-05-proxy-matcher-gated-prefixes.md`.

## Context

The first `proxy.ts` matcher entry skips any path containing a static extension, and that test has no end boundary. So `/admin/members/x.css`, `/admin/x.js/y` and `/admin/members/x.jsfoo` all skipped the proxy, which holds the admin role gate (deep review C-2) and the credential rate limit. The Active CPU session asked whether that could expose anything.

## Finding

Nothing is exposed, in any route family checked: `(admin)`, `(member)`, `(flow)` and `(public)/credentials`.

- With the proxy skipped, Clerk's `auth()` throws, because it reads the middleware's headers and not the cookie. A real session gains nothing on a skipped path.
- A forged `x-clerk-auth-status: signed-in` also fails, because it needs the signature.
- A forged `signed-out` header stops the throw, but the request is then signed out and page guards redirect it.
- Token and credential pages reject a value containing a dot before any lookup, or tie the token to the slug. `pay-seat` is the exception (`.4`).
- `/_nextfoo` is a 404, `/_next/image?url=/admin/...` is a 400, and `/%61dmin` runs the proxy.

The weakness is what a forged signed-out header leaves: each page's own guard, and nothing else. A future dynamic admin page without a guard, whose data doesn't depend on its segment, would serve that data to anyone. No such page exists now.

## What changed

- `proxy.ts`: a third matcher entry, covering `admin`, `account`, `community`, `home`, `campaigns`, `credentials`, `team-profile`, `survey`, `register`, `sign`, `check-in` and `scholarship/offer`. The existing entries are untouched.
- `test/proxy-matcher.test.ts`: 21 gated paths that must run the proxy, and 17 paths that must skip it, including `/check-in-desk-sw.js`, `/sign.js`, `/homepage.png` and `/scholarship/offers.png`.

#556 landed later on `dev` and keeps this entry. It adds an exact-path skip for `/_vercel/` and more `.txt`/`.xml` cases.

**Cost:** no real file sits under these prefixes, so legitimate traffic should add no proxy runs. Scanners and malformed URLs will add runs, but those requests used to render a full page to a 500, so CPU should fall. This is reasoning, not a measurement (`.3`).

## Verified

- Local `next dev` with dev keys, before and after the change. Results are in the PR #553 body. Production was not touched.
- PR CI: `e2e-tests` 203 passed, 1 flaky (`.8`), 43 skipped. `e2e-local` 204 passed, 43 skipped.
- Dev push CI on `15071aed`: every job succeeded, and the build and `npx playwright test` steps ran.
- The Vercel dev deployment of `15071aed` is READY.

## Not verified

- Any request to the deployed dev site or to production. All behaviour checks ran locally on `next dev`.
- A real signed-in session on these paths, including the role gate for a non-admin (`.2`). That a real session gains nothing on a skipped path comes from reading Clerk's source.
- A live `pay-seat` token (`.4`).
- That each admin and member page has its guard before its first data read. Most of that is from reading code, with samples requested locally.
- Proxy-run volume (`.3`).

## Traps

- A new gated route group must add its prefix to this entry (`.5`).
- Add an exact path to skip the proxy, never an extension. `proxy.ts` says so too, since #556.
- A worktree `.env.local` from before the Supabase key rename lacks `SUPABASE_SECRET_KEY`, so every database read throws and local 500s prove nothing about data. The first probe here had to be discarded for that reason.
- This session's worktree and local branch stay until the app session is archived. `npm run worktrees` lists it as app-managed.
