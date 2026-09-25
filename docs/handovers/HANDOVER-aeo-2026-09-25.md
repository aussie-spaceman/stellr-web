# Handover — AEO phases 1–4, 24–25 Sept 2026

Follows `docs/handovers/HANDOVER-aeo-2026-08-10.md` and the Google Doc "AEO
Session Close-Out — 10 Aug 2026 (v2)". Audience decided: **teachers first**.

## Landed on `dev`
- **#198** — sitemap lastmod (no more "now"; Sanity `_updatedAt`), app-host `X-Robots-Tag: noindex`, Course / LearningResource (NGSS) / Product / BreadcrumbList schema, Organization `audience` removed and "free to enter" corrected, Google/Bing verification tags (env), IndexNow route + `npm run indexnow`, `crawler_hits` table + proxy counting + `npm run aeo:crawlers`, fixed prompt panel + `npm run aeo:panel`, `docs/RUNBOOK-aeo-measurement.md`.
- **#200** — `/guides/stem-competitions-for-schools` (sourced comparison), `/guides/run-an-engineering-design-challenge` (summary only), FAQs + FAQPage on `/competitions` `/curriculum` `/educators`, `llms.txt` and stat accuracy fixes, news drafts (`docs/content-drafts/2026-09-aeo/`), off-site plan (`docs/PLAN-aeo-offsite-2026-09-24.md`).

## Close-out items from August, now
| Item | State |
|---|---|
| B1 OG image | Done (before this session) |
| B2 Rich Results / schema validation | Done for pre-existing + #198 pages (0 issues). **#200 pages not validator-checked** — validator.schema.org 405'd; parse + FAQ-visible checks only |
| B3 Measurement baseline | Tooling live; **no baseline yet** — needs an API key |
| B4 sameAs | Closed — all five opened in a browser |
| B5 Search Console resubmit | Open — David |
| B6 news author in queries | Done |
| C1/C2 NewsArticle + author | Open — publish the first news post (drafts ready) |
| D1 sitemap lastmod | Done |
| D2/D3/D4 Course / LearningResource / Product | Done (Product unit-tested only — no active products on dev) |

## Before promotion (David)
1. Apply `supabase/migrations/20260925024500_crawler_hits.sql` to **production** (dev done; ledger at the filename version).
2. Production Vercel env: `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION`, `INDEXNOW_KEY`.

## After promotion
- Resubmit sitemap in Search Console; add the site to Bing Webmaster (import from GSC).
- `npm run indexnow`; validate the two guide pages on www.
- Publish the two news drafts in Sanity with a named author.

## Standing decisions
- Never name the ISSDC / Space Settlement Design Competitions / Aerospace Education Competitions / Space Science Engineering Foundation family in public content, prompts or reports.
- The how-to guide stays a summary; session plans, the worked trade study and intervention guidance are member material.
- Stellr live-event fees are described as "varies by event" — no single figure.
- The prompt panel's prompts are fixed; retire and add, never reword.

## Scheduled
- "AEO monthly prompt panel" — 9am on the 2nd of each month (local Claude scheduled task). Produces nothing until one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `PERPLEXITY_API_KEY` / `GEMINI_API_KEY` is in `.env.local`.

## Fix at source
- Sanity event tagline "Humanities Place In The Solar System" → "Humanity's Place…".
- Campaign date display "08-15 – 12-15, 2026" on campaign pages.
- Campaign Guide (Teacher, ADVANCED) trade-study totals: 3.25 / 2.85 / 3.10, not 3.20 / 2.90 / 3.15.
