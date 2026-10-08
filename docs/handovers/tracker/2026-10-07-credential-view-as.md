# Credential page in admin view-as — 2026-10-07

Slug: `credential-view-as`. Handover: `HANDOVER-credential-view-as-2026-10-07.md`. Doc snapshot: `1mZcqta0lnM15u5T56Jnlz4M-FtyC989hFDoL2mfImV4`.
PR #317 → `dev` as `ead6b79`; promoted in #318 (`ee441ad`). Migration: none.

An admin viewing as a member can now open that member's credential page. It stays on `app.` while the view-as cookie is set, with the view-as banner. Without the cookie, `app./credentials/*` still redirects to www.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| credential-view-as.1 | **HIGH.** The reported fix, on prod | Live since 7 Oct (`ee441ad`). Only the signed-out paths were checked on prod: a forged cookie gives the private page on app, and no cookie gives a 308 to www. Never exercised signed in as an admin. | Admin → Members → Lily Nylund → View as → Credentials → click a row. Expect her owner page with the yellow banner, URL on `app.`. | ☐ |
| credential-view-as.2 | A student opening their own private credential on www | Assumes Clerk's session is shared from `app.` to `www.`. Not checked this session. | Signed in as any student with a credential, click a row on `app.`. Expect a redirect to www showing owner controls, not "This credential is private". | ☐ |
| credential-view-as.3 | No automated test for the proxy exemption | `proxy.ts` has no tests. The single-host dev and e2e setup cannot exercise the app→www redirect. | A unit test that runs the proxy with a two-host `APP_HOST`/`SITE_URL`, with and without the cookie, or a decision that it isn't worth it. | ☐ |
| credential-view-as.4 | Other www-only pages during view-as show the admin's view | Same host-only cookie. Event detail, `/register`, `/privacy` and the rest redirect to www, where view-as does not apply. Not reported as a problem. | Decide whether view-as needs to cover www. A parent-domain cookie would widen view-as to every www page, which needs its own write-guard review. | ☐ |
| credential-view-as.5 | Survey e2e flaked on #318 | 5 survey specs failed once (headings not visible in 5 s) at `13a65a4`. The re-run passed at the same SHA, and the runs were serialised. | Watch for a repeat. If it recurs, capture the trace and look at shared dev-DB survey state. | ☐ |
| credential-view-as.6 | Stale worktree `../stellr-web-promote-record` (6 Oct, branch merged) | Still present. Promote Step 8 collided with the path, so this session used another one. | `git worktree remove --force ../stellr-web-promote-record` | ☐ |
