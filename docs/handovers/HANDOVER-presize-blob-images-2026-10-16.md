# Handover — Pre-sized Blob images (image transformations, Phase 3) — 16 Oct 2026

Slug `presize-blob-images`. Tracker: `tracker/2026-10-16-presize-blob-images.md`.
Phase 3 of the three-phase plan David approved on 16 Oct, after Vercel warned that team `stellreducation` had used 75% of its 5,000 monthly Image Optimization transformations. Phase 1 is #436 (image config) and Phase 2 is #437 (Sanity images). A coordinating session started this one and owns the plan and the promotion.

## Context

Since #427 (live 16 Oct), the three student-work slides (PNG, up to ~600 KB each) and the video posters (`.poster.jpg`) on the `stellr-media` Blob store went through `next/image`. That re-encoded each one at several widths, and each resize counts against the monthly quota. The files never change, so this session sizes them once at upload with sharp and serves them as they are, which costs no transformations.

## What changed

- **#439 → `dev` (`fd7bccaf`), not promoted.** Promotion PR #441 (Phases 1–3, opened by the coordinating session) was OPEN at close-out.
  - `scripts/upload-media.ts`: files matching `PRE_SIZE` (`media/*/student-work-*.png`, `videos/*/*.poster.jpg`) also get WebP copies, cut in memory with sharp at quality 75, the `next/image` default.
    - The widths come from `sizedWidths()`: 640, 1080 and 1600, capped at the source width (upscaling adds bytes, not detail). Each copy is stored next to its original as `<name>-<width>.webp`.
    - The copies go through the same pathname + size check as every other file, so a re-run skips them. `addRandomSuffix: false` and the 1-year cache are unchanged, and originals are never altered.
  - `lib/media-helpers.ts`: `SIZED_WIDTHS`, `sizedWidths()`, `sizedPath()` and `sizedSrcSet()`. The script and the manifest both use them, so the srcset names exactly the files that were uploaded.
  - `lib/media-manifest.ts`: each slide carries a `srcSet` (`slide(path, width, alt)`), and each video a `posterSrcSet` (`video(id, title, posterWidth = 1280)`).
    - Sources: slides 1 and 2 are 1600 px wide, slide 3 is 720 px. Posters are 1280 px, except one at 640 px.
  - `StudentWorkHero` and `VideoTestimonial` render a plain `<img>`. It carries the srcset and the same `sizes`, `loading="lazy"`, `decoding="async"` and the same fill layout. `next/image` is no longer imported by either.
  - `posterSrcSet` is passed at all 9 `VideoTestimonial` call sites. The brief named 3 videos, but the component is shared, so every poster page moved off the optimizer.
  - Tests: `lib/media-helpers.test.ts`, `StudentWorkHero.test.tsx` and `VideoTestimonial.test.tsx`. The component tests assert the srcset, the `sizes`, lazy loading and the absence of any `/_next/image` URL.
  - `next.config.mjs` is untouched, as the brief required (Phase 1 owns it).
- **Blob upload (production store, approved by David in session, 16 Oct):** 33 WebP files, 1.6 MB: 8 under `media/2026-10/` and 25 under `videos/2026-10/`.
  - It ran in two passes, `--only=media` then `--only=videos`, so `robots.txt` was not re-put.
  - No local copy of the media sources exists. The originals were downloaded from the store into a scratch directory and used as `--src`; since they matched by size, they were skipped.

## Verified (and how)

- **Upload:**
  - Each of the 33 URLs returns `200 image/webp` with `cache-control: public, max-age=31536000`.
  - A dry run afterwards reports `0 to upload, 45 already current`.
  - The original slide PNG still has its original byte length.
- **Local production build** (`next start`, `NEXT_PUBLIC_MEDIA_BASE_URL` set to the media host):
  - On /competitions, /curriculum and /scholarship, the server HTML and the browser's resource list show no slide or poster through `/_next/image`. The other six poster pages render the poster srcset too.
  - At 375 px and 1280 px (DPR 2), each image loads its `-1080` copy (or `-720` for the 720 px slide) and looks right. There is no horizontal overflow at 375 px.
- **CI on #439** (head `93706d64`), read step by step:
  - **verify:** every step succeeded (309 unit-test files).
  - **e2e:** 214 tests; 168 passed, 45 skipped, 1 flaky. The flaky one is `e2e/core/survey.spec.ts:125`, which this change doesn't touch, and it passed on retry.
  - **Storybook:** 39/39 passed, including both `VideoTestimonial` stories under render + axe.
- **Dev deployment** `dpl_HbV8ykqehRcYWBBxfrfvMSSDeBhJ`, READY on `fd7bccaf`, opened at its own URL (pinned to the commit):
  - /competitions at 1280 px, and /curriculum and /scholarship at 375 px: slides and posters load their WebP copies, with 0 `/_next/image` requests and no overflow.
  - #436 turns `images.unoptimized` on for the dev project, so on dev this proves the images render. The proof that they skip the optimizer comes from the local build.

## Not verified / known limits

- **Production:** nothing from this session is live until #441 merges (row `.1`). The check after promotion is row `.2`.
- **The meter itself:** Hobby has no usage API. Whether transformations stop climbing from Blob sources is only visible on the dashboard (row `.3`).
- **The header logo** `/images/logo-horiz.png` still goes through `/_next/image` on every page (row `.4`).
- **Phones:** at 375 px with DPR 2, the browser picks the 1080 copy for a 341 px frame. A tighter `sizes` alone wouldn't change that, because the next step down is 640. It would need an extra ~750 px width, saving roughly 30–40 KB per slide (row `.5`, parked).
- **Adding a slide or poster:** run `upload-media.ts` and set the source's real pixel width in the manifest. A wrong width makes the srcset name files that don't exist, and nothing checks the manifest against the store.

## Noticed in passing

- The report-only Lighthouse step in e2e logs "Run #1...failed!": in CI, `/events/nevada-space-design-challenge` returns 404 (`ERRORED_DOCUMENT_REQUEST`). I saw it in #439's run, and the Phase 2 session saw it on #437. It's not related to images, and the step is report-only, so the job still passes.
- The worktree `.claude/worktrees/nervous-hellman-edabb9` is app-managed and stays until this session is archived (row `.6`). The merged local branch `fix/presize-slides-posters` was deleted after its tip was checked against #439's `headRefOid`.

## Open items

See `tracker/2026-10-16-presize-blob-images.md`.
