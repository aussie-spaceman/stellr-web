# Image transformations: diagnosis, plan, Phase 1 config — 2026-10-18

Slug: `image-transformations`. Handover: `HANDOVER-image-transformations-2026-10-18.md`. Doc snapshot: `1sea4Hr-CIGChALIbw-I4Miuu4gzhFAyafWyxhR3Ff70`.
PR #436 → `dev` as `0aaf19a4`; not promoted (#441 open at close-out, driven by the "Promote dev to prod" session). Migration: none.

next/image now makes WebP only, at widths 64–1920 and quality 75, and keeps copies for 31 days. It accepts only our Sanity project, our media host and the listed local folders. The `stellr-web-dev` project serves original images. Phases 2 and 3 are `sanity-images` and `presize-blob-images`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| image-transformations.1 | #436 in production | On `dev` as `0aaf19a4`. Promotion #441 (Phases 1–3, #440, docs) was OPEN at close-out, with CI re-running on `50041d19` after #443. The separate "Promote dev to prod" session drives it, and on 18 Oct David decided this session merges nothing | That session merges #441 through `promote` | ☐ |
| image-transformations.2 | Production check for #436 | Not run. Checked locally (`next start`) and in CI only | After #441, read the server HTML of www `/`, `/events` and `/competitions`. Every srcset should offer only 64–1920, and nothing should be AVIF. Never fetch a production `/_next/image` URL: each uncached fetch costs a transformation | ☐ |
| image-transformations.3 | Dev project serves original images | Verified 16 Oct. Deployment `dpl_GoT6fkLBQqTYWpsnaf1TtaK1hJMb` (`0aaf19a4`) was read through the Vercel MCP's authenticated fetch. `/competitions` had 0 `/_next/image` URLs: the logo comes from `/images/`, and slides and poster from the media host | — | ☑ |
| image-transformations.4 | The meter falls, and the diagnosis holds | Not measurable from here: Hobby's billing and observability APIs return 404. The cause (AVIF and the mobile review, #430) rests on timing and config, not on the usage graph | A week after #441, David reads Vercel Usage → Image Optimization: the daily rate should be well below the 15–16 Oct level, and the jump should start on 15–16 Oct. If most of the 3,750 came earlier, look at Observability → Image Optimization's top sources | ☐ |
| image-transformations.5 | Usage-period reset date | Unknown. If the meter reaches 100% before the reset, uncached images show alt text until it resets | David reads the reset date on the Vercel Usage page | ☐ |
| image-transformations.6 | Mobile speed without AVIF | Not measured. The mobile review's baseline is Lighthouse mobile 80–92 | After #441, run one mobile Lighthouse on www `/competitions` and `/events` and compare | ☐ |
| image-transformations.7 | Drop `/api/img` from `localPatterns` | After #437, no next/image `src` uses `/api/img` (only `lib/sanity-image.ts` calls `wmSrc()`, for a plain `<img>`). The entry only lets the optimizer accept those URLs. This supersedes `sanity-images.7`, whose State ("`localPatterns: [{ pathname: '/**' }]`") predates #436 | Grep for a next/image `src` that starts with `/api/img`. If there is none, remove the entry and its test line in a small config PR | ☐ |
| image-transformations.8 | Clerk avatar on `/account` | It is `unoptimized` now (loads from Clerk's CDN), but this hasn't been seen on a signed-in page | On the next signed-in `/account` visit, check that the avatar renders | ☐ |

## Closes

- `presize-blob-images.4` (header logo still goes through the optimizer). The coordinating session decided to **leave it**.
  - It is one local source, cached by content hash for up to 31 days, and the browser picks its 256 or 384 copy. That is a handful of transformations a month.
  - `unoptimized` would send the 12 KB PNG on every page instead of the smaller WebP.
  - Verified locally on 16 Oct: `/competitions` at 375 px requested `/_next/image?url=%2Fimages%2Flogo-horiz.png&w=256`, served as `image/webp`.
