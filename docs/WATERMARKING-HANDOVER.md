# Copyright Watermarking — Handover

**Goal:** "© Stellr Education" baked into the bottom-right of every photo, every video, and
every page of every downloadable PDF, across www + app.stellreducation.org — retroactively
and for all future content.

**Status (2026-07-02):** Built + backfilled + verified. `tsc` clean, `next build` green.
UNCOMMITTED on `main` (git auth is push-by-hand). No new runtime infra needed.

## Locked decisions
- Images: **baked into pixels** (sharp), not CSS overlay.
- Videos: public testimonials + a **pre-upload master** tool for YouTube/embeds. Private
  JaaS recordings were **scoped out**.
- Docs: watermark generated + static + uploaded PDFs; **exclude** DocuSign signed
  agreements + Stripe receipts (external/legal).

## What was built

### Core — `lib/watermark/`
- `config.ts` — single style source (text, font scaling, margins, `WATERMARK_MARKER`).
- `pdf.ts` — `stampPdfDocument(doc)` (used by generators), `stampPdfBytes(bytes)` (uploads +
  batch), `isPdf(name, mime)`. Idempotent via a Keywords marker.
- `image.ts` — `watermarkImageBuffer(buf, {outputFormat?})` via sharp; preserves avif/webp/
  jpeg/png; skips images with shorter edge < 96px. **Imported by the /api/img route — keep it
  free of node-only APIs (no child_process).**
- `video.ts` — `watermarkVideoFile(in, out)` via ffmpeg drawtext (resolves ffmpeg-static →
  FFMPEG_PATH → system ffmpeg).

### Wiring (future content is stamped automatically)
- Generated PDFs: `lib/certificate.ts`, `lib/event-pdf.ts` — `stampPdfDocument` before save.
- Uploaded PDFs: **4 routes** — `app/api/community/resources/attach`,
  `app/api/admin/community/spaces/[id]/resources`, `app/api/admin/community/training/resources`,
  `app/api/admin/community/resources` (this last one was found unwired and fixed in close-out).
- CMS images: `app/api/img/route.ts` (sharp, `nodejs` runtime, cdn.sanity.io allowlist,
  immutable cache) + `wmSrc()` in `lib/sanity.ts`, used at 5 display sites: news list,
  news detail (cover + related), event detail, `components/ui/EventCard.tsx`.

### Backfill scripts (`scripts/`, run via tsx) + manifest
- `watermark-pdfs.ts`, `watermark-media.ts`, `watermark-videos.ts`, `check-watermarks.ts`,
  shared `scripts/lib/watermark-fs.ts`.
- `scripts/watermark-manifest.json` — sha256 of every watermarked /public asset (395 entries).
- npm scripts: `watermark:pdfs|media|videos|all|check`.
- **Enforcement:** `prebuild` runs `check-watermarks.ts` → build fails if any in-scope
  `/public` asset (media, student-work, team, video posters, PDF covers, testimonial MP4s,
  static PDFs) isn't in the manifest. Escape hatch: `WATERMARK_CHECK=off`.

### Backfilled: 12 static PDFs, 371 images, 12 testimonial MP4s.
`watermark-media.ts` has an **ffmpeg dav1d decode fallback** for ~23 AVIFs the bundled
libheif can't re-read ("bad seek"). All scripts are idempotent via the sha manifest.

## How to re-stamp after a style change
Edit `lib/watermark/config.ts`, then restore originals so the mark isn't stacked:
`git checkout -- public/media public/student-work public/team public/videos public/files`,
delete their `scripts/watermark-manifest.json` entries, then `npm run watermark:all`.

## Gated-video worker (NEW — private recordings + training-lesson videos)
Vercel can't run ffmpeg, so these are watermarked out-of-band:
- **Migration `119_video_watermark_jobs.sql`** — a service-role job queue (must be applied).
- **Enqueue**: `app/api/webhooks/recording/route.ts` (after offload) and
  `app/api/admin/community/training/items/route.ts` (POST + PATCH, `content_kind='video'`);
  the same training route now also stamps `content_kind='document'` PDFs inline.
- **Worker**: `scripts/watermark-worker.ts` (`npm run watermark:worker`, or `--once` for cron)
  claims pending jobs, downloads from Supabase, burns the mark via `lib/watermark/video.ts`,
  and overwrites the file in place. Uses `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- Model is **overwrite-in-place** (recording still publishes immediately; the mark lands once
  the worker runs). There is a short window before processing where the raw file is served —
  acceptable because recordings are login-gated. If a zero-window guarantee is wanted later,
  gate playback on job `status='done'`.
- **The worker must be deployed somewhere with ffmpeg** (container/cron/box) or these videos
  never get marked. Nothing on Vercel runs it.

## What was already committed vs new this session
The **core** (lib/watermark/*, scripts/watermark-*, /api/img, the 4 upload routes, backfilled
binaries, manifest, guard) was **already built + committed** by the prior 2026-07-02 session
(commits `e800089`, `0a3f715`) — HEAD assets are correctly single-watermarked (verified). This
session's **net new** work is only: the gated-video worker (migration 119, video-queue.ts,
watermark-worker.ts, recording/training wiring, `watermark:worker` script) plus 11 tests
(`lib/watermark/{pdf,image}.test.ts`, `app/api/img/route.test.ts`).

## Open gaps / decisions (see the status .docx in the Drive root)
1. **Apply migration 119**, then **commit + deploy** (3 modified + 6 new files this session).
2. **Deploy the worker** (item above) on a host with ffmpeg; without it, gated videos stay
   unmarked.
3. **Runtime-verify after deploy** (IP-critical): `/api/img` on live Sanity images (already
   verified locally against a real asset), PDF stamping on a real upload, and one worker job
   end-to-end (upload a training video → confirm the stored file gets stamped).
4. **Existing YouTube/Vimeo/Wistia embeds**: DECISION = out-of-scope (third-party hosted). The
   pre-upload tool `tsx scripts/watermark-videos.ts <file>` stays available for future uploads.
5. Deliberate exclusions to confirm: community-space uploaded **images** (member content),
   OG/social-share images, Store/Printful product images, the 128px testimonial avatar.
6. Video git footprint (12 MP4s, 47–57 MB) — consider Git LFS or the media CDN
   (`NEXT_PUBLIC_MEDIA_BASE_URL`).
