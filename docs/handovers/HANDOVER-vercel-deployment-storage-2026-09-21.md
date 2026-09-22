# Handover — Vercel Deployment Storage, 21 Sept 2026

**For:** whoever next touches deploys, `/public`, the media manifest, or gets a
Vercel usage email.
**Prompted by:** Vercel's email of 21 Sept — team `stellreducation` at **100%
of Deployment Storage (10 GB)**, six days after the Function Storage session.

## 1. Three meters, not one

The 15 Sept session (`HANDOVER-vercel-function-storage-2026-09-15.md`, #92)
fixed **Function Storage** — lambda bundles per retained deployment — and cut
builds from six per PR to two. Its §1 says `public/` was "not a contributor".
True for that meter. This alert is a different one:

| Meter (Hobby, 10 GB each) | Counts | 15 Sept | 21 Sept |
|---|---|---|---|
| Function Storage | function bundles, per region, per retained deployment | 75% → fixed | — |
| **Deployment Storage** | **build output + static assets** per retained deployment | not looked at | **100%** |
| Deployments/day | count | rate-limited 10 Sept → fixed | — |

Vercel: "Deployment Storage is cloud storage for the build output and Vercel
Function bundles retained with your deployments" and per deployment
"Deployment Storage — Build outputs and static assets; Functions Storage —
Vercel Function bundles" (https://vercel.com/docs/deployment-storage). Metered
as GB-month: the daily maximum per project, summed over the billing period.

## 2. Why it was 10 GB

Every deployment of `stellr-web` shipped `public/` = **515 MB** (videos 453,
`media/` photos 32, `files/` PDFs 27) + `.next/static` 11 MB + ~48 MB of
functions ≈ **0.57 GB of output per build**. On 21 Sept the two projects held
10 READY deployments (prod 3, dev 6, `apollo-hubspot-bridge` 1) → ~5.7 GB
structurally. The rest is the tail of the 15 Sept purge: 343 deleted
deployments each carried the same 515 MB, and Vercel staff tell Hobby users
deleted deployments "won't free up immediately … wait 30 days"
(community thread 49486). So the meter was still paying for deployments
that no longer exist.

On 16 Sept Vercel also changed Hobby retention: each project keeps only its 3
most recent production + 3 most recent of any type, and over-limit teams have
non-exempt deployments deleted immediately (changelog "Hobby projects now
retain fewer deployments to free up storage"). The *count* lever is therefore
Vercel's now and already at its floor. The only lever left in the repo was
output size per deployment, and 90% of it was testimonial MP4s.

## 3. What changed (PR: `chore/media-to-blob`)

**Media moved to Vercel Blob.** A public store `stellr-media`
(`store_L3ZaBOZgfPZ3vAHd`, iad1, connected to `stellr-web`) now holds
`videos/`, `media/`, `files/` under the same paths `/public` had, and
`NEXT_PUBLIC_MEDIA_BASE_URL=https://l3zabozgfpz3vahd.public.blob.vercel-storage.com`
is set on **both** Vercel projects, all three environments, plus both CI env
blocks. `lib/media-manifest.ts` was already written for this — `mediaUrl()`
prefixes the var — so the pages needed no change. `public/` is now **3.4 MB**
(fonts, icons, team, student-work). `git rm` of 416 files; history keeps them.

**Videos re-encoded first.** 720p H.264 CRF 24, ≤ 30 fps, AAC 96k,
faststart: **453 MB → 176 MB** (largest 72 → 18 MB; `meleah-caron` 50 → 33 MB
is the noisiest source). The burned-in "© Stellr Education" mark is in the
pixels, so it survives. Originals are not in the repo any more; the pre-move
bytes are in git history at `9fcabb8` if a re-cut is ever needed.

| Clip | Before | After |
|---|---|---|
| tom-wilson | 72.3 MB | 18.4 MB |
| apoorva-somani | 57.0 | 19.5 |
| sepp | 53.9 | 13.3 |
| willcox-teachers | 53.6 | 17.4 |
| meleah-caron | 49.6 | 32.8 |
| mia-cox | 43.6 | 15.4 |
| teacher | 30.3 | 9.2 |
| noah-swingle | 30.0 | 18.4 |
| jeremiah-dibley | 26.5 | 10.2 |
| alvina-gakhokidze | 24.0 | 7.2 |
| david-shaw | 11.0 | 9.2 |
| allyson-rose | 9.1 | 7.2 |

**Code.**
- `lib/media-manifest.ts`: `mediaUrl()` exported; new `mediaDownloadUrl()`
  appends `?download=1` when a host is set, because browsers ignore the
  `download` attribute on cross-origin URLs and Blob answers that query with
  `Content-Disposition: attachment` (verified with curl). `COMPETITION.fileHref`
  goes through it; `previewHref`/`thumbnail` stay inline.
- Six `/files/…` literals that bypassed the manifest now use it:
  `curriculum`, `network`, `why-stellr` (AssetGate `fileUrl`), `grant`
  (`ONE_PAGER`, opens inline → `mediaUrl`), `WhitePaperGate` (`PDF_URL`),
  and the emailed links in `app/api/white-paper` + `app/api/asset-request`
  (the latter's private `MEDIA_BASE` copy removed).
- `VideoTestimonial.tsx`: `crossOrigin="anonymous"` on the `<video>` — without
  it the cross-origin captions `<track>` is refused. Blob sends
  `access-control-allow-origin: *` (verified).
- `scripts/upload-media.ts` (`@vercel/blob` added): idempotent by pathname +
  size, `addRandomSuffix: false`, one-year cache, multipart over 50 MB, also
  writes a `robots.txt` (`Disallow: /`) to the store root. Needs
  `BLOB_READ_WRITE_TOKEN` locally (the CLI wrote it into the main checkout's
  `.env.local` when the store was created).
- `next.config.mjs` `images.remotePatterns` was **not** touched: photos render
  through raw `<picture>/<img>` (`ResponsivePhoto.tsx`), not `next/image`.

**Docs.** `ENV-MATRIX.md` §3 row + a Deployment Storage note under the build
rule; `.env.local.example`; this file; TRACKER § Session 10;
`WATERMARKING-HANDOVER.md` gap #6 closed.

## 4. Numbers to expect

Per shipped PR: one `dev` build + one `main` build at ~60 MB of output each
(was ~570). At the Hobby floor of 3+3 retained per project that is well under
1 GB of Deployment Storage once the 30-day tail from the 15 Sept purge rolls
off (~15 Oct). Until then the team figure may stay high; if a deploy is
refused, the only escape is a Pro trial/upgrade — there is nothing left to
delete that Vercel's own retention has not already taken.

**The new meter to watch is Blob transfer**: Hobby includes 1 GB storage
(store is 238 MB) and **10 GB transfer per month**; on overage Blob is cut off
for 30 days (https://vercel.com/docs/vercel-blob/usage-and-pricing), which
would 404 every testimonial video on the public site. Videos are click-to-play
with `preload="none"`, so only real plays count — ~10 GB ≈ 600 full plays of
an average 15 MB clip. Check Observability → Blob monthly; if it climbs, the
answer is R2 (needs the DNS zone on Cloudflare; it is on GoDaddy today) or
YouTube unlisted, not another re-encode.

## 5. Operating notes

- **Adding media:** put the file under a local `media/{videos,media,files}/`
  folder (outside the repo), run `npx tsx scripts/upload-media.ts --src=…`
  (dry run) then `--apply`, then reference it in `lib/media-manifest.ts`.
  Nothing goes in `public/videos|media|files` any more.
- **Replacing media:** new id, new file — the blobs cache for a year and the
  manifest ids are the URLs. Overwriting in place needs a cache bust.
- **Local dev without the var** renders relative `/videos/…` paths that 404.
  Set `NEXT_PUBLIC_MEDIA_BASE_URL` in `.env.local` (example file has it).
- `vercel remove <id…> --yes --scope stellreducation` is still the way to
  delete deployments by hand; `npx -y vercel@latest` works (no global install).
- The Vercel MCP token is read-only for env vars (403 on create); the CLI is
  logged in and can write them.

## 6. Not done / left for the maintainer

1. **The Usage page was not read.** Same gap as 15 Sept (TRACKER 6.1): the
   figure needs a signed-in browser. Read
   https://vercel.com/stellreducation/~/usage → Deployment Storage → Projects
   and write the before/after here.
2. **Deployment cleanup not run.** The plan's Phase 0 (`vercel remove` of the
   7 CANCELED and 3 superseded dev deployments) was refused by the session's
   auto-mode classifier as an irreversible delete. Command, with the live ids
   already asserted out:
   `npx -y vercel@latest remove dpl_9PFraHwkBbJwUj2yMJz2r9e3215P dpl_ABhaezigr7Fy8GCUo7ChQcH8DUx1 dpl_CSwuucn8GtifdZ8iUHUnVZm7f4s1 dpl_8QAmCv9xJcvZhf1ohVi4Uh92QCgx dpl_646J9TUiBJda9HXZPYoTFHieNFmD dpl_AgA8RpoJoUCoUBcFY62t4FCyLX4K dpl_BJtYcd8jaUC9C3gUSEwyY2HkDy6P dpl_GdoaaG8P7wcbMWighk2odmm4TxBA dpl_ZDUGAj5uwfx1qY5kymu4oK2z1zSd dpl_5c2y7hm6pZx7Fe6MYNWgU9bNBLBT --yes --scope stellreducation`.
   Marginal now (canceled builds have no output) — Vercel's 16 Sept retention
   will take the READY ones anyway.
3. **Plan fit.** Three usage alerts in six days on a site running Stripe
   checkout, Clerk auth, a member app and 13 crons. Vercel's Hobby fair-use
   terms are for non-commercial personal use, and Deployment Storage on Pro is
   $0.10/GB-month. A deliberate decision, not another optimisation session.
4. **Repo pack is 1 GB** (the MP4 history). Git LFS or a history rewrite;
   not urgent.
5. **Sanity Studio** (TRACKER 6.5, 10 MB/deployment) stays deferred — 2% of
   the problem.

---

## 7. Close-out addendum (22 Sept 2026)

Everything below happened after §1–§6 were written. §6's "not done" list is
superseded by this section.

### 7.1 It shipped and it is live

`9782de5` (#129) → `dev`; promoted as `3ea4d59` (#133); production
`dpl_F2C5snFhgjeuZEvDGvpNCaRJzgwF` READY. Record:
`.claude/releases/promote-2026-09-21b.md` (marked Promoted in #135).

Production verified after the deploy: www 200, app 307 → `/sign-in`, cron guard
401, every media URL on the Blob host with no relative `/videos|/media|/files`
left in the HTML, **`/videos/testimonial-david-shaw.mp4` → 404** (the proof the
bytes are out of the deployment), MP4 206 `video/mp4`, PDF `?download=1` 200
`application/pdf`, `/students` AVIF srcset resolving, kept `public/` asset 200,
OG card 200 `image/png`.

The promotion also carried three PRs from other sessions that were already on
`dev` — #128 Checkr hardening, #130 vitest glob, #131 verifiable credentials +
LinkedIn (which needed migration `20260921120000_credentials`, applied to
production before the merge). That was not planned work for this session; it
came with the branch.

### 7.2 §6.2's cleanup command was wrong by the time it ran

It was rebuilt from a live listing and run on 22 Sept (TRACKER 10.2): **27
deployments deleted**, not 10. The written list had gone stale in ~16 hours —
several ids no longer existed, and it **missed the six superseded READY `dev`
builds, which were the only ones still holding pre-Blob output**. The CANCELED
ones it did list carry no output at all, so the command as written would have
freed nothing.

**Lesson for the next person: never run a stored deployment-id list.** Re-list,
rebuild the set, assert the live/rollback ids out of it, then delete.

### 7.3 §6.1 failed a third time

The Usage figures still are not read. On 22 Sept the Claude-in-Chrome connector
was tried (the user's own Chrome carries the Vercel session) and reported **not
connected**. No Claude surface available here can load a signed-in vercel.com
page. This is a maintainer action, not an agent one — see TRACKER 10.1.

### 7.4 New, found during close-out

- **A stray production ledger row** (`20260922142559`) — the credentials
  migration was applied twice because a parallel session's record claimed it was
  applied while `db:status --prod` still reported it pending. Idempotent SQL, no
  duplicate rows; cosmetic. TRACKER 10.6.
- **`NEXT_PUBLIC_MEDIA_BASE_URL` was never added to any local `.env.local`** —
  §Phase 4 of the plan said to and only Vercel + CI were done. `npm run dev`
  would 404 all media. Fixed in the main checkout; TRACKER 10.7.
- **The original master MP4s were not archived to Drive** as the plan said —
  they exist only in git history at `9fcabb8`, which couples them to never
  rewriting that history. TRACKER 10.8, blocking 10.9.
- **Two sessions promoted the same `dev` at once.** TRACKER 10.10.

### 7.5 What to watch now

Blob transfer, not Deployment Storage: 10 GB/month on Hobby and a **30-day
cutoff** on overage, which would 404 every testimonial on the public site.
Store is 238 MB of a 1 GB allowance. Videos are click-to-play with
`preload="none"`, so only real plays count (~600/month of an average 15 MB
clip). Observability → Blob, monthly.
