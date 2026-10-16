# Handover: Sanity images skip the image optimizer (16 Oct 2026)

Slug `sanity-images`. Tracker: `tracker/2026-10-16-sanity-images.md`.
Committed and on `dev`: #437, squash-merged as `590599c7`. **Not promoted.** The coordinating session's promotion PR #441 (Phases 1–3 plus #440) was open at close-out, and the promotion belongs to that session.

## Context

On 16 Oct Vercel reported that team `stellreducation` had used 75% of its 5,000 monthly Image Optimization transformations. On Hobby, once the meter reaches 100%, uncached images return a 402 error and show only their alt text. David approved a three-phase fix:

1. #436: `next.config.mjs` changes (WebP only, fewer widths, own sources, image optimization off on the dev project).
2. **This session, #437:** Sanity images stop going through Vercel's image optimizer entirely.
3. #439: pre-sized Blob slides and posters.

Before #437, each Sanity image was processed three times:
- Sanity resized it.
- `/api/img` stamped the watermark.
- `/_next/image` re-encoded it at up to ten widths, each one billed as a transformation. That included the widths at or above the source's own width, which are just the same picture again.

## What changed

- `components/ui/CoverImage.tsx` renders a plain `<img>` filling its box. With `priority` set (the event and news heroes), it calls `preload()` from react-dom with `imageSrcSet` and fetches at high priority, the same as next/image's `priority`. The file also holds `CARD_IMAGE_SIZES`, the `sizes` string for each card grid.
- `lib/sanity-image.ts`: `sanityImage(source, preset, sizes)` returns `{ src, srcSet, sizes }`. Every entry is `/api/img?src=<Sanity URL>` with `w`, the matching `h`, `fit=crop`, `fm=webp` and `q=75`. Widths larger than the original (or its editor crop) can supply are dropped.
- `lib/sanity-image-params.ts` holds the presets and has no dependencies: `card` 360/540/720/1080 at 600:352, `eventHero` 640/960/1280/1920 at 21:9, `newsHero` the same widths at 5:2. `isSiteSanityImage()` is the check `/api/img` runs.
- `/api/img` serves only the widths and transforms the site uses: a preset width and its height, `fit=crop`, `fm=webp`, `q=75`, and an optional `rect` that must fall inside the original. It also requires one asset filename directly under the project/dataset path, and rejects a port, credentials or a fragment. Anything else gets a 400. The project pin, raster-only Content-Type, 15 MB cap and fail-closed watermark are unchanged.
- Call sites switched to the new component:
  - `EventCard`, which gained an `imageSizes` prop; the home page passes `threeUp`.
  - `CampaignCard`, whose `CampaignCardData.imageUrl` became `image: SanityImageProps`.
  - `/events`, `/news`, `/news/[slug]` (hero and related posts) and the `/events/[slug]` hero.
- The news cards now use the event cards' crop, so a cover image has one set of URLs across `/news` and related posts.
- OG and metadata `urlFor` calls are untouched.

## Decisions

- **No `getImageProps`, although the brief suggested it.** It takes widths from `images.deviceSizes`/`imageSizes`, which #436 changed and which `/api/img` would then have to mirror. It also drops the srcset whenever `images.unoptimized` is on, and #436 turns that on for the dev project. The helper keeps its own width list, and the route reads that same list.
- **No width larger than the original.** Sanity's CDN upscales with `fit=crop`, so such a width is only an enlarged copy. The Colorado SDC hero's original is 1140 px wide, so it offers only 640 and 960. On a 1280 px screen the browser upscales the 960 copy. Under the hero's 40% opacity it reads fine. A hero that looks soft needs a wider original uploaded in Sanity, not code.

## Against the brief

| # | Done when | Met? | Evidence |
|---|---|---|---|
| 1 | No `/_next/image?url=%2Fapi%2Fimg` in /events, /news, a /news/[slug], an /events/[slug], /competitions | Partial | Local `:3018` (dev keys): 0 on /events, /competitions, /events/colorado-space-design-challenge, a campaign page and /. The dataset has **no news posts**, so /news and /news/[slug] are covered only by `app/(public)/news/news-images.test.tsx` (mocked post, real builder). Not checked on a deployed build. |
| 2 | Watermarked and sharp at 375 and 1280 px | Met locally | All 36 distinct `/api/img` URLs returned 200 `image/webp` at exactly the requested size, with the watermark in the pixels. In the browser pane (DPR 2), cards pick 720 at both widths (checked against uncached probe URLs at 375). The hero loads eagerly with a `<head>` preload. |
| 3 | Tests and `lint:tokens` pass | Met | Local: 2346/2346, tsc, lint:tokens, lint:ci 42/42. CI on #437: verify, e2e 169/169 and Storybook 39/39, with every step `success`. |
| 4 | Shipped to dev with `ship` | Met | #437 merged as `590599c7`. The `stellr-web-dev` deployment of that SHA is READY. The ship skill's Phase 1 checklist and Phase 4 table were not shown before landing ("ship means proceed"). This table stands in for them. |

## Not verified

- Anything on a deployed build. Dev sits behind Vercel Authentication, and no bypass secret was available locally. Check on production after #441 (`sanity-images.3`).
- The meter itself. Hobby has no usage API (`sanity-images.4`).
- News images with real content (`sanity-images.5`).

## Open items

`sanity-images.2` to `.7` in the tracker file.
