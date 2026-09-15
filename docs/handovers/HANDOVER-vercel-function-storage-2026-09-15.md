# Handover — Vercel Function Storage, 15 Sept 2026

**For:** whoever next touches deploys, `vercel.json`, or a server dependency.
**Prompted by:** Vercel's email of 15 Sept — team `stellreducation` at 75% of
the free-tier **Function Storage (10 GB)**. At 100% Vercel refuses new
deployments, which stops `ship` and `promote`.

## 1. What Function Storage is, and why it was 7.5 GB

Function Storage is the size of the serverless function bundles held for every
*retained* deployment. Hobby never expires deployments and has no retention
policy (Pro+), so it only falls when deployments are deleted. Usage is
(bundle size per deployment) × (retained deployments). Both were high.

**Deployments.** Both Vercel projects (`stellr-web` prod, `stellr-web-dev`)
are linked to this repo and nothing in it limited which branches built. Each
PR produced six deployments — feature-branch preview, `dev` preview, `main`
build, in each project. On 15 Sept alone: 17 on prod, 16 on dev, for six PRs.
The prod project's previews were never used (CI runs E2E against a local
build) and were already flagged in `REC-deploy-environments-2026-09-07.md`
§1.3 as writing to production systems. The same volume caused the
"Deployment rate limited — retry in 24 hours" that held the 10 Sept promotion
three days. 38 remote branches existed, 34 of them landed and stale, each
still holding previews.

**Bundle size.** Vercel packs the app into 4 Node lambdas. The local trace
(`.next/server/**/*.nft.json`) unioned to 62.7 MB. Baseline routes are
1.5–3.7 MB. The outliers:

| Cause | Traced | Routes |
|---|---|---|
| `googleapis` — the monolith bundles all 566 Google APIs into one 11.9 MB chunk; the code uses Sheets v4, Drive v3, Calendar v3 and a JWT | 14–15 MB each | `register/group`, `members/teams/[id]/sheet-sync`, `webhooks/google-sheets`, `registrations/[id]/spreadsheet`, `cron/motion-bookings` |
| `next/og` `ImageResponse` on the Node runtime — traces sharp's 15 MB libvips plus the og runtime into the OG route **and** the sibling page | 22 MB + 20.5 MB | `/lp/[slug]`, `/lp/[slug]/opengraph-image` |
| `sharp` for the on-the-fly watermarker | 17.5 MB | `/api/img` (genuine; kept) |
| Sanity Studio SSR bundle | 10 MB | `/studio/[[...tool]]` (kept; see §5) |
| `ffmpeg-static` — a devDependency, but Vercel installs those; a dynamic import at `lib/watermark/video.ts:19`, no route imports it *today* | 0 (latent ~70 MB) | — |

Not contributors: `public/` (523 MB of video) and the fonts — static, not in
any function trace.

## 2. What changed (PR: `chore/vercel-function-storage`)

**Build rule, in git.** `vercel.json` → `ignoreCommand: bash
scripts/vercel-ignore-build.sh`. Keys on `VERCEL_PROJECT_ID`: prod builds
`main` only, dev builds `dev` only, unknown project or empty ref builds and
says why. Overrides the dashboard Ignored Build Step on both projects (the old
one on `stellr-web-dev` is now inert; leave it). Verified: the push of this
branch was **Canceled on both projects**. Six deployments per PR → two.

**Bundles.** Local trace union **62.7 → 47.6 MB**; routes over 4 MB **9 → 2**
(`/api/img`, `/studio`, both expected).

- `googleapis` → `@googleapis/sheets`, `@googleapis/drive`,
  `@googleapis/calendar` + `google-auth-library@11`. Same call surface
  (`sheetsApi({ version: 'v4', auth })`, `new JWT({...})`). All five routes
  are now baseline. `google-auth-library` is pinned to v11 so the per-API
  packages dedupe onto one copy — v10 + v11 side by side is a nominal type
  clash on `JWT`, which is what the first `tsc` run showed.
  `scripts/check-golive-config.mjs` got the same swap.
- `/lp/[slug]/opengraph-image.tsx` → `runtime = 'edge'`. Edge forbids
  `generateStaticParams`, so it was removed; the card renders on first request
  and the CDN caches it, and an unknown slug gets the generic headline. Next
  still adds `@vercel/og` + sharp to the *page's* trace because a metadata
  image exists in the segment, so `next.config.mjs`
  `outputFileTracingExcludes['/lp/**']` drops them — the page never renders
  the card. Rendered locally: 1200×630 PNG for both slugs and for an unknown
  one. Note the route carries a hash suffix (`opengraph-image-k8l0a9`); the
  page's `og:image` meta tag points at it, and the bare path 404s. That is how
  Next names metadata routes, not a regression.
- `outputFileTracingExcludes['*']` fences off `ffmpeg-static`.

**The required check on `main`.** `main`'s ruleset requires
`Vercel – stellr-web`. For a skipped build Vercel reports that check as
**SUCCESS** ("Canceled by Ignored Build Step", observed on PR #92), so
promotion PRs merge without waiting on a build — but the check no longer
proves the production build *before* the merge. The `main` build the merge
triggers is where a broken build would surface; watch it (promote Step 7).

**Docs/skills.** `ENV-MATRIX.md` has the build rule. `ship` Phase 3: feature
branches have no preview; the `dev` alias after squash-merge is the first
deployment. `promote` Step 5: the Vercel signal is the production build the
merge triggers, not a PR preview.

## 3. The purge

Stale branches: 34 deleted, each proven landed by content first (30 ancestors
of `dev` with zero diff; three handover-only branches byte-identical to the
copies in `docs/handovers/`; `fix/space-resources-in-spaces-2026-08-27` with
an empty two-dot diff — landed as squash `a7b8e57`). Kept: `main`, `dev`,
`docs/promote-2026-09-15c` (open PR #90).

Deployments, via `vercel api /v13/deployments/<id> -X DELETE`, live
deployments asserted out of the delete set before any call:

| Project | Before | Kept | Deleted |
|---|---|---|---|
| `stellr-web` | 229 | 10 newest READY `main` builds (rollback depth; oldest 10 Sept) | 219 — 122 previews of `dev`/feature branches, 79 older `main` builds, 18 canceled/errored |
| `stellr-web-dev` | 127 | 3 newest READY `dev` builds | 124 — 77 previews, 15 pre-15-Sept `main` builds, 6 older `dev` builds, 26 canceled/errored |

Both live production deployments (`dpl_7gmENar…` on prod, `dpl_ECCW2UX…` on
dev) were asserted out of the delete set before any call and re-checked after;
www.stellreducation.org served 200 throughout.

Function Storage in the dashboard: **before 7.5 GB (75%)**. The after figure
was not readable from this session (no browser session on vercel.com) — read
it at https://vercel.com/stellreducation/~/usage and note it here. With 13
retained deployments at ≤ 63 MB each it cannot be more than ~0.8 GB, and
Vercel's usage graph may lag deletions by a day.

Mechanics, for next time: `vercel api … -X DELETE` refuses to run
non-interactively; `vercel remove <id> <id> … --yes --scope stellreducation`
works, takes many IDs per call, and reports on stderr (~1 min per 20).

## 4. What to expect from now on

Per PR: one `dev` build (dev project) at squash-merge, one `main` build (prod
project) at promotion. At ~48 MB each, that is ~100 MB per shipped PR against
10 GB. Deleting old production builds periodically is still the only expiry
Hobby offers; the inventory + delete scripts are trivial to recreate from §3.

## 5. Not done

- **Sanity Studio** (`/studio/[[...tool]]`, 10 MB). Hosting it via
  `sanity deploy` would take it out of the function bundle. Revisit if usage
  climbs.
- **PR previews** are gone by design. If they are wanted back, that is a Pro
  question (retention policies + more Function Storage), not a repo change.
- The `docs/promote-2026-09-15c` branch and PR #90 were left as found.

## 6. Close-out (session 6, 15 Sept 2026, ~23:15Z)

**Tracker:** `docs/handovers/TRACKER.md` § Session 6 is canonical. Google Doc
snapshot (a copy, never the source):
https://docs.google.com/document/d/1JVlQ_-Y2wM9BNHIG-rQVVrHD76HxKbU3axW_8DKmUDM/edit

**Promoted.** #93 → `bf0cb24` 22:51Z; production `dpl_Gw8vgHxmo3p71vtrpAy14sNtEwoy`
READY — the first `main` build under the ignore rule. www 200 · app 307 →
/sign-in · cron guard 401 · OG card 200 on the edge, byte-identical to local.
Record: `.claude/releases/promote-2026-09-15d.md` (#94; renamed from -15c in #96 — session 5's #91 was the third promotion).

### What was asked and not done, or done narrower than it reads

1. **The after-figure for Function Storage was not measured.** Verification
   step 5 of the plan said "dashboard before and after". The Chrome extension
   was not connected and the usage page needs a signed-in browser; the "cannot
   exceed ~0.8 GB" in §3 is arithmetic (13 deployments × ≤ 63 MB), not a
   reading. → Tracker 6.1.
2. **The Sheets API itself was not exercised through the new package.** The
   pre-merge smoke test authenticated (JWT), listed Drive files and listed
   calendars — all 200 through `@googleapis/*`. It created a Sheets client but
   made no `spreadsheets.*` call because the bare service account owns no
   sheets (production impersonates the owner account). The PR body's "JWT /
   Drive / Calendar exercised" is accurate; read it as "Sheets not exercised".
   → Tracker 6.2. This is the one runtime path changed today that no test or
   curl has touched since the swap.
3. **The plan's OG-image step was delivered differently from how it was
   written.** The plan said edge runtime "still pre-renders the known slugs at
   build"; Next refuses `generateStaticParams` on an edge route, so it was
   removed and the card renders on first request (CDN-cached). Verified on
   production; the difference is one cold render per slug, not a behaviour
   change. Said at the time; recorded here so the plan file is not read as
   what shipped.
4. **Old rollback ids are gone.** The purge kept the 10 newest `main` builds
   (oldest 10 Sept). Release records older than that name deployment ids that
   no longer exist. Deleted with consent; noted so nobody plans a rollback
   around a record without checking. → Tracker 6.3.
5. **`scripts/check-golive-config.mjs`** got the client swap and a syntax
   check only. → Tracker 6.7.
6. **Not asked, but observed and left:** the required `Vercel – stellr-web`
   check on `main` now passes for skipped builds. Documented in three places;
   whether to keep it required is a maintainer decision. → Tracker 6.4.

### Recommendations

- **Read the usage figure** and put it in §3 — one number closes the headline
  question of the session.
- **Watch the first real Sheets call**: the next group registration creates a
  spreadsheet via `register/group`; a `sheet-sync` from any team page reads
  one. Either proves 6.2. `cron/motion-bookings` runs 12:00 UTC; its runtime
  log on 16 Sept proves the Calendar path in production.
- **Decide on the required Vercel check** (6.4). Keeping it is harmless;
  dropping it stops it being mistaken for a build proof.
- **Sanity Studio hosting** (6.5) only if usage climbs again — at ~48 MB per
  deployment and two deployments per PR, it should not.
- Session 5's close-out (#90) was still open at this close. Its handover is
  not on `dev` until it merges.
