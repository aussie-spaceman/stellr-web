# Handover: credential page in admin view-as, 7 Oct 2026

Tracker: `docs/handovers/tracker/2026-10-07-credential-view-as.md` (rows `credential-view-as.1`–`.6`).
Code: #317 → `dev` as `ead6b79`. Promoted in #318 (`ee441ad`, deployment `dpl_Ci3UB3WCSUbtvr1FPD25wDiSa8bB`), with e-sign #316 and #319 from other sessions. Release record: `.claude/releases/promote-2026-10-07.md` (#321). Migration: none.

## The report
David, viewing as Lily Nylund (Colorado SDC), saw her three credentials and could download each PDF, but could not open a credential.

## Cause
- The view-as cookie `stellr_impersonate` is set host-only on `app.` (no `domain`, in `app/api/admin/impersonation/route.ts`).
- `proxy.ts` lists `/credentials(.*)` as public-only, so every credential row 308s from `app.` to `www.`. The cookie isn't sent there.
- `getCurrentMember()` on www therefore resolves the admin, who isn't the owner, so the page says "This credential is private".
- The PDF route `/api/credentials/*/pdf` isn't public-only, stays on `app.`, and so worked.

The symptom was inferred from the code; David did not confirm the exact screen.

## What changed (#317)
- **`proxy.ts`:** on the app host, `/credentials/*` is not redirected to www while the `stellr_impersonate` cookie is present. The page re-checks the cookie and the admin claim, and the canonical URL stays www.
- **`lib/impersonation-cookie.ts`:** the cookie name alone, so the proxy needn't import `lib/impersonation` (next/headers, Clerk, Supabase).
- **`lib/impersonation.ts`:** `viewAsBannerProps(member)`, shared by the member layout and the credential page. The layout's inline lookup moved here, with the same queries and output.
- **`app/(public)/credentials/[number]/page.tsx`:** shows the `ImpersonationBanner` in all three states (withdrawn, private, full).

Writes stay blocked. The visibility route already calls `assertNotImpersonating()`.

## Verified
- CI on #317: `verify` and `e2e` passed.
- Locally: tsc clean on the touched files, and `lib/impersonation.test.ts` 6/6.
- **Prod, after deploy, signed out:**
  - `app./credentials/STL-2026-SHDA0N63` with no cookie: 308 to www (unchanged).
  - Same URL with a forged cookie: 200 on app, "This credential is private" only, no holder details and no banner.
  - www: 200, private page.

## Not verified
- **The fix itself:** a signed-in admin viewing as a member and clicking a credential row on prod (`credential-view-as.1`). Dev cannot reproduce the bug: it is single-host (`IS_SINGLE_HOST`), so the app→www redirect never fires there.
- **A real student opening their own credential on www (`.2`):** this relies on the Clerk session being shared across subdomains. That was assumed, not checked in this session.

## Worth knowing
- Every other www-only route (event detail, `/register`, `/privacy`…) opened from the portal during view-as shows the admin's own view, for the same reason (`.4`).
- The #318 e2e run failed 5 survey specs once (headings not visible in 5 s) and passed on re-run at the same SHA. Runs were serialised, so it was not overlap (`.5`).
- The main checkout's `node_modules` is missing the e-sign deps (`node-forge`, `@signpdf/*`, `@pdf-lib/fontkit`), so a full local `tsc` there shows errors unrelated to any change. Use `npm ci` in a worktree.
