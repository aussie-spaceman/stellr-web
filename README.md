# Stellr Education — Public Website

**Stack:** Next.js 14 (App Router) · Sanity CMS · Tailwind CSS · TypeScript  
**Domain:** www.stellreducation.org

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.local.example .env.local
# Fill in your Sanity project ID, dataset, and API token
```

### 3. Initialise Sanity project (first time only)
```bash
npx sanity@latest init --env .env.local
# Choose "Use existing project" if you already created one in sanity.io
```

### 4. Run dev server
```bash
npm run dev
# → http://localhost:3000
# → Sanity Studio at http://localhost:3000/studio
```

## Build Order Progress

| Step | Task | Status |
|------|------|--------|
| 1 | Scaffolding + dependencies | ✅ |
| 2 | Tailwind config + tokens | ✅ |
| 3 | Sanity schemas | ✅ |
| 4 | Global layout: nav + footer | ✅ |
| 5 | Marketing pixel component | ⬜ |
| 6 | Home page (Sanity-wired) | ⬜ static only |
| 7 | Events listing + detail | ⬜ stub |
| 8 | Why Stellr page | ⬜ stub |
| 9 | Membership page | ⬜ stub |
| 10 | About page | ⬜ stub |
| 11 | News listing + article | ⬜ stub |
| 12 | Contact page + /api/contact | ⬜ stub |
| 13 | Donate page | ⬜ stub |
| 14 | Privacy policy | ✅ placeholder |
| 15 | SEO: metadata, JSON-LD, sitemap | ⬜ |
| 16 | Seed Sanity content | ⬜ |
| 17 | Vercel deploy + DNS | ⬜ |

## Placeholder Brand Tokens

Colours are centralised in `tailwind.config.ts` and `styles/globals.css`.  
Swap for final brand colours when design assets arrive — it's a 15-minute change.

| Token | Placeholder value | Purpose |
|-------|------------------|---------|
| `brand-navy` | `#0A0F1E` | Primary backgrounds, headings |
| `brand-blue` | `#2563EB` | Accent, CTAs, links |
| `brand-grey-light` | `#F3F4F6` | Section backgrounds |
| `brand-grey-dark` | `#374151` | Body text |

## Audience landing pages (`/lp/[slug]`)

Audience-specific landing pages for paid campaigns. One layout, one config per
audience — **adding a page needs no layout work**:

1. Add `content/lp/<slug>.ts` exporting a `LandingPageConfig`
   (see `content/lp/types.ts`; copy `first-robotics-teachers.ts` as a starting
   point). Anything that should read the same on every page belongs in
   `content/lp/shared.ts` instead.
2. Register it in the `PAGES` array in `content/lp/index.ts`.
3. Ship. The route, the sitemap entry and the social share image all derive from
   the registry.

Two things you must **not** type into a config:

- **Location counts.** Use `{{locations}}`, `{{states}}`, `{{live}}` and
  `{{planned}}` (capitalise the token for a capitalised word). They are filled
  from `lib/locations.ts` at render time. Four hand-typed versions of these
  numbers had already drifted apart before this existed, and `content/lp`'s
  tests fail if a literal count reappears.
- **A hero photo that is also in the gallery.** Both pages share one gallery, so
  a repeat shows the same photograph twice on one screen. Also enforced by test.

Locations come from two places, merged and deduped by `lib/locations.ts`: live
`event` documents (in-person, dated, US state, `showOnLocationMap` not unticked)
and `plannedLocation` documents. Untick **Show on landing-page map** on an event
to keep it off the marketing map without touching its dates or slug. Coordinates
are backfilled by `npx tsx scripts/backfill-lp-locations.ts` (dry run by default,
`--apply` to write).

The lead form posts to `/api/lp-lead`, which goes through `captureLead()` like
every other lead route. One shared HubSpot form serves all audience pages;
`lp_audience` and `lp_source_page` separate them in reporting.

## Sanity Studio

Embedded at `/studio`. Access requires a Sanity account with write permission on the project.  
Protect with Google OAuth in Sanity project settings before going live.
