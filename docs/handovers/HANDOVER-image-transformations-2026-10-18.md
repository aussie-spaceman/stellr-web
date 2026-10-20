# Handover: Image transformations, diagnosis and Phase 1 (16–18 Oct 2026)

Slug `image-transformations`. Tracker: `tracker/2026-10-18-image-transformations.md`.
Committed and on `dev`: #436, squash-merged as `0aaf19a4`. **Not promoted.** Promotion PR #441 carries Phases 1–3, #440 and close-out docs. It was open at close-out, and the separate "Promote dev to prod" session is driving it. On 18 Oct David decided that this session leaves #441 to that session and merges nothing from here.

This was the coordinating session. It read the Vercel alert, diagnosed it, wrote the plan, built Phase 1, and started the Phase 2 and Phase 3 sessions. Their handovers are `HANDOVER-sanity-images-2026-10-16.md` (#437) and `HANDOVER-presize-blob-images-2026-10-16.md` (#439).

## Context

At 19:43 UTC on 16 Oct, Vercel emailed that the Hobby team `stellreducation` had used 75% of its 5,000 monthly Image Optimization transformations. On Hobby there is no charge for going over. Instead, at 100%, any image not already cached returns a 402 error, and the page shows its alt text. Cached images keep working.

Vercel counts a transformation each time it has to generate an image it hasn't cached. The cache key is project, source URL, width (`w`), quality (`q`) and the normalised `Accept` header, which decides the format. A copy lasts until its TTL expires: up to 31 days for local files, and `max(upstream max-age, minimumCacheTTL)` for remote ones.

## Diagnosis

The alert came about five hours after #430 (the mobile review, #427) reached production at 14:58 UTC. The mobile review caused the jump. The setup it landed on was already wasteful.

From the mobile review (#427, finding P6 "Heavy images"):
- **AVIF + WebP** (`formats`). Each format is a separate copy of every image. The switch also stopped AVIF browsers from using the WebP copies already cached, so every image was generated again.
- **`sizes` on card and hero images.** Downloads got smaller, but each device now picks a different width than before, so the cache was missed once more.
- **Slides and posters moved onto the optimizer.** They had been a plain `<img>` and cost nothing. The review had recommended pre-sizing them, which became Phase 3.
- **Measurement traffic.** 12 device profiles and 1,068 page loads on 15 Oct, then a second round on 16 Oct, against both projects.

Already there before it:
- **Widths larger than the source.** Sanity covers have been fetched at 600 px (cards) and 1400 px (heroes) since the June build, and through `/api/img` since July. next/image offered widths up to 3840, and every width above the source is the same picture re-encoded, each one counted.
- **The dev project keeps its own cache.** The cache key includes the project, so every image viewed on `stellr-web-dev` was generated a second time.
- **Allowlists wider than our own sources.** The remote and local patterns accepted far more than the site uses.
- **SVGs went through the optimizer** only because of `dangerouslyAllowSVG`. Next 16 serves `.svg` as-is without it.

This rests on the timing and the config. It has **not** been checked against Vercel's daily usage graph (`image-transformations.4`).

## The plan (approved by David on 16 Oct, all recommended options)

1. **#436 (this session):** the `next.config.mjs` image settings.
2. **#437:** Sanity images become a plain `<img>`, resized by Sanity and watermarked by `/api/img`, with zero transformations. `/api/img` serves only the preset widths.
3. **#439:** slides and posters become pre-sized WebP copies on `stellr-media`, served as they are.

## What changed in #436

`next.config.mjs` now builds `images` from `imagesConfig(env)`, which is exported so it can be tested.
- `formats: ['image/webp']`.
- `deviceSizes [640, 828, 1080, 1200, 1920]` and `imageSizes [64, 128, 256, 384]`. These are **subsets of Next's defaults on purpose**, so copies cached at those widths still match. A new width list would generate every image again once. `qualities [75]`.
- `minimumCacheTTL: 2678400` (31 days).
- `remotePatterns`: `cdn.sanity.io/images/<project>/<dataset>/**` and the media host. Both are read from env, and each is dropped when its variable is unset. Unsplash, Clerk and the wildcard Blob host are gone.
- `localPatterns`: `/api/img` (which takes a query string), and `/images/**`, `/team/**`, `/media/**`, `/videos/**` with `search: ''`.
- `dangerouslyAllowSVG` is removed.
- `unoptimized: env.VERCEL_PROJECT_ID === DEV_PROJECT_ID`, the ID `scripts/vercel-ignore-build.sh` uses. Vercel exposes `VERCEL_PROJECT_ID` at build time, and local or CI builds behave like production.
- `components/member/AccountProfile.tsx`: the Clerk avatar is `unoptimized`.
- `lib/next-config-images.test.ts` pins all of the above.

## Verified

- CI on #436 (`7b4242a8`). Every step concluded `success`: PII lint, typecheck, design-system lint, unit tests, lint ratchet, build, Playwright, Storybook, Lighthouse.
- Local production build (`next build` + `next start`).
  - `required-server-files.json` holds the new `images` config.
  - On `/`, `/events`, `/competitions`, `/curriculum`, `/about`, `/news` and `/scholarship`, srcsets offer only 64–1920.
  - All 21 distinct optimized sources returned 200 `image/webp` to an AVIF-accepting `Accept` header: `/api/img`, the media host, `/images` and `/team`.
  - Each of these returned 400: another Blob host, another Sanity project, Unsplash, a query string on `/images/…`, a path outside the list, and `w=3840`.
  - In the browser, every image loaded on `/competitions` at 375 px and on `/events` at 1024 px.
- Dev deployment `dpl_GoT6fkLBQqTYWpsnaf1TtaK1hJMb` (`0aaf19a4`), read through the Vercel MCP's authenticated fetch. The `/competitions` HTML has no `/_next/image` URL: the logo comes from `/images/`, and the slides and poster from the media host.
- Before relaying the merge approval, this session reviewed #437's diff: `CoverImage`, `lib/sanity-image*.ts` and the `/api/img` change. It read only part of #439's diff, the manifest, and relied on that session's report and CI.

## Not verified

- **Production.** Nothing from this work is live until #441 merges (`.1`, `.2`).
- **The meter.** Hobby has no usage or observability API: `/v1/billing/charges` and `/v2/observability/schema` both return 404. The reset date is unknown too (`.4`, `.5`).
- **Mobile speed without AVIF** (`.6`).
- **The `/account` avatar** on a signed-in page (`.8`).

## Gotchas for the next session

- **Never curl a production `/_next/image` URL to "check" it.** Each uncached fetch is a transformation. This session spent two that way on 16 Oct. Read the page HTML instead.
- **Keep width lists as subsets of what is already cached.** Otherwise one deploy regenerates every image.
- **`localPatterns` mismatches fail quietly in production.** `next dev` throws, but a production build answers 400 and the page shows alt text.
- **Phase 2 doesn't use `getImageProps`.** It takes widths from this config and drops the srcset under the dev project's `unoptimized`. See the sanity-images handover.

## Open items

See `tracker/2026-10-18-image-transformations.md`: `.1`–`.8`. It also closes `presize-blob-images.4` (decision: the header logo stays on the optimizer) and supersedes `sanity-images.7`, whose State predates #436.
