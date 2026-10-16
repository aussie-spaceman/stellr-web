# Sanity images skip the image optimizer — 2026-10-16

Slug: `sanity-images`. Handover: `HANDOVER-sanity-images-2026-10-16.md`. Doc snapshot: `1uGpSJxf_Ar9eYKtUwKtZ5xtkGBIY9dBz9X5CN2iogjc`.
PR #437 → `dev` as `590599c7`; not promoted (#441 open, owned by the coordinating session). Migration: none.

Sanity cover and hero images render as a plain `<img>` whose srcset points at `/api/img` (watermarked, WebP, preset widths only), so they never reach `/_next/image`. `/api/img` returns 400 for any width or transform the site doesn't use.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| sanity-images.1 | Land on `dev` and build | #437 merged 16 Oct as `590599c7` (`gh pr view` reads MERGED). Every verify and e2e step concluded `success` (e2e 169/169, Storybook 39/39). `list_deployments` shows the `stellr-web-dev` deployment of `590599c7` READY | — | ☑ |
| sanity-images.2 | Production | Not promoted. Promotion PR #441, open at close-out, includes #437 | The coordinating session merges #441 through `promote` | ☐ |
| sanity-images.3 | Check on the live site | Verified only on a local server (`:3018`, dev keys) and in CI. Dev is behind Vercel Authentication, with no bypass secret available locally | After #441: view source of www `/events` and `/events/<slug>`. Expect no `/_next/image?url=%2Fapi%2Fimg`. Open one srcset `/api/img` URL: expect 200 `image/webp` with the watermark. Never curl `/_next/image` | ☐ |
| sanity-images.4 | Effect on the transformations meter | Can't be read through an API on Hobby | A day after promotion, David checks Vercel Usage → Image Optimization: Sanity images should add no transformations | ☐ |
| sanity-images.5 | News images with real content | The production dataset had 0 `newsPost` documents on 16 Oct. /news and /news/[slug] are covered only by `app/(public)/news/news-images.test.tsx` (mocked post) | When the first post is published, view /news and the article at 375 and 1280 px and check the cover's srcset | ☐ |
| sanity-images.6 | `/api/img` URLs in the old format | A URL without the preset `w`/`h`, `fm=webp` and `q=75`, which covers every URL emitted before #437, now returns 400. Pages rendered after the deploy don't use them; copies held elsewhere (shared links, a search engine's image index) would break. Not measured | A week after promotion, count 400s on `/api/img` in the production runtime logs. Decide only if there are many | ☐ |
| sanity-images.7 | `localPatterns` still allows any query string | `next.config.mjs` keeps `localPatterns: [{ pathname: '/**' }]`. It was added only so `/api/img?src=…` could go through next/image, and after #437 no page does that. Left alone because the config belongs to #436 | Look for any next/image local `src` that still carries a query string. If there is none, add `search: ''` in a config PR | ☐ |
