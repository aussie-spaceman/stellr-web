# REC: SEO / AEO Audit of Public Pages (F-24)

**Status:** Recommendation — no code changed. | **Date:** 2026-07-03

## What's already in place (better than expected)

The static audit found the foundations are **solid** — this is a gap-filling job, not a rebuild:

- **`app/sitemap.ts` EXISTS** — static routes + dynamic `/events/[slug]` and `/news/[slug]` from Sanity.
- **`app/robots.ts` EXISTS** — allows `/`, disallows `/studio/` and `/api/`, points at the sitemap.
- **Root metadata is correct** (`app/layout.tsx`): `metadataBase` (from `NEXT_PUBLIC_SITE_URL`), title template `%s | Stellr Education`, default description, `openGraph` (siteName/type/locale), `twitter.card = summary_large_image`.
- **Organization JSON-LD** is emitted in `app/layout.tsx` (name, logo, contactPoint, LinkedIn sameAs).
- **Per-page metadata coverage is nearly complete**: 31 of 36 public pages export `metadata`/`generateMetadata`, including all pillar pages (`/about`, `/academy`, `/competitions`, `/membership`, `/why-stellr`, `/impact`, etc.).
- **Marketing pixels (FR-WEB-09) are fully implemented** in `components/analytics/MarketingPixels.tsx`: GTM, GA4 (+ route-change pageviews), Meta Pixel, LinkedIn Insight — all env-gated (`NEXT_PUBLIC_GTM_ID`, `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_LINKEDIN_PARTNER_ID`) plus Vercel Analytics. Code-complete; the only check is that the four env vars are actually set in Vercel production.
- Redirects in `next.config.mjs` are clean (`permanent: true` 308s for retired paths); default trailing-slash behavior (consistent, fine).

## The gaps

### P1 — Sitemap omits ~15 public pages (`app/sitemap.ts`)
`staticRoutes` lists only 9 URLs (home, events, why-stellr, membership, about, news, contact, donate, privacy). **Missing:** `/academy`, `/competitions`, `/curriculum`, `/educate`, `/educators`, `/students`, `/mentors`, `/network`, `/impact`, `/scholarship`, `/store` (and `/store/[slug]` products), `/volunteer`, `/host-an-event`, `/events/why-design-competitions`, `/terms`. These include the highest-value audience landing pages built in the June redesigns — search engines can still crawl them via links, but they're second-class citizens for indexing priority. One-file fix.

### P1 — No default Open Graph image
Root `openGraph` in `app/layout.tsx` has no `images`, and no `opengraph-image.(png|tsx)` file exists anywhere in `app/`. Only `news/[slug]` and `events/[slug]` set OG images (Sanity cover images via `generateMetadata`). **Every other page — including the homepage — shares links with no preview card image.** Fix: one 1200×630 branded image at `app/opengraph-image.png` (Next auto-wires it site-wide) or `openGraph.images` in the root metadata.

### P1 — Registration funnel pages have no metadata and are indexable
The 5 pages under `app/(public)/register/[slug]/` (index, `individual`, `group`, `join/[token]`, `confirmation`) export no metadata and no `robots: noindex`. Grep found **zero** `noindex` usage in the whole public tree. Join-by-token URLs and confirmation pages should never be indexed. Fix: add `export const metadata = { robots: { index: false } }` to each (and consider the same for `check-in/[slug]`).

### P2 — No canonical URLs
No `alternates.canonical` anywhere under `app/(public)` (grep confirmed). `metadataBase` gives correct `og:url`s, but no `<link rel="canonical">` is emitted, so `www` vs apex vs query-string variants can split ranking signal. Fix: add `alternates: { canonical: '/<path>' }` to each public page's metadata export (mechanical, ~30 files) — or at minimum the top-10 pages.

### P2 — JSON-LD beyond Organization (the AEO play)
Only two JSON-LD emitters exist: Organization (`app/layout.tsx`) and `app/(public)/events/[slug]/page.tsx`. For answer-engine optimization (Google AI Overviews, Perplexity, ChatGPT browsing), add:
- **`FAQPage`** on `/membership` — FAQ content already exists in `app/(public)/membership/tier-data.ts` / `MembershipExplorer.tsx`; the highest-leverage AEO win because pricing/tier questions are what people ask engines.
- **`NewsArticle`** on `news/[slug]` (it already has OG images; schema is a small addition).
- **`Course`** on `/academy` and **`Product`** on `store/[slug]`.

### P3 — Housekeeping
- `app/robots.ts` serves identical rules to both `www` and `app.stellreducation.org` (one Next app, host-routed). Member/admin routes are auth-gated so exposure is low, but disallowing `/admin/` and member paths on the app host (host-aware robots) is cheap insurance.
- Verify the four pixel env vars are set in Vercel prod (code is ready; this is ops, not code).
- Sitemap `lastModified: new Date()` on every static route on every request tells crawlers everything changed daily — use real/omitted dates.

## Priority summary

| # | Fix | File(s) | Size |
|---|---|---|---|
| P1 | Add ~15 missing pages (+ store products) to sitemap | `app/sitemap.ts` | XS |
| P1 | Default OG image | `app/opengraph-image.png` (new) | XS |
| P1 | `noindex` the register funnel | 5 files under `app/(public)/register/` | XS |
| P2 | Canonical URLs | metadata exports under `app/(public)` | S |
| P2 | FAQPage / NewsArticle / Course / Product JSON-LD | membership, news, academy, store pages | M |
| P3 | Host-aware robots, pixel env-var check, sitemap dates | `app/robots.ts`, Vercel dashboard | XS |

**Recommended next step:** Ship the three P1 items as one small PR (sitemap completion, default OG image, noindex on the register funnel), then confirm the pixel env vars in Vercel. **Effort: S** (P1 batch is ~1–2 hours; the full P2 JSON-LD pass is a separate M).
