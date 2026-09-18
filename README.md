# Stellr Education — web

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind (Design System V2 tokens)
· Clerk (auth) · Supabase (data) · Sanity (public-site content) · Stripe · Resend · DocuSign ·
HubSpot · Vercel

One codebase serves three surfaces, split by host in `proxy.ts`:

| Surface | Host | Route group |
|---|---|---|
| Public site | `www.stellreducation.org` | `app/(public)` |
| Member app | `app.stellreducation.org` | `app/(member)`, `app/(auth)` |
| Admin console | `app.stellreducation.org/admin` | `app/(admin)` |

Plus `app/api` (webhooks, crons, member/admin APIs), `/studio` (embedded Sanity Studio),
and the shared component library in `packages/` (`@stellr/web-ui`, `@stellr/icons`).

## Before you write UI

Read [`CLAUDE.md`](CLAUDE.md) (design system, tokens, component library) and
[`VOICE.md`](VOICE.md) (copy). Both are binding.

## Quick start

```bash
npm ci
cp .env.local.example .env.local   # then fill in the DEV values — see docs/ENV-MATRIX.md
npm run dev                         # scripts/dev.mjs claims a free port per worktree
```

`.env.local.example` documents every variable and which service it belongs to. Local
development points at the **dev** Supabase and Clerk instances; `scripts/dev.mjs` refuses
to start with production credentials (`scripts/production-guard.mjs`).

Several sessions work on this repo at once. Each one uses its own git worktree —
see [`docs/CONCURRENT-SESSIONS.md`](docs/CONCURRENT-SESSIONS.md).

## Checks

| Command | What it gates |
|---|---|
| `npx tsc --noEmit` | types |
| `npm run lint:tokens` | no pre-V2 brand hex / font names in UI code |
| `npm test` | vitest unit tests |
| `npm run test:e2e` | Playwright, against a dev deployment (`e2e/`) |
| `npm run build` | `prebuild` regenerates tokens, then runs the token lint, migration-name lint and watermark check before `next build` |

CI (`.github/workflows/ci.yml`) runs typecheck → token lint → unit tests → build on every
PR to `dev` and `main`, and the E2E suite when its secrets are configured.

## Branches and deploys

`dev` is the integration branch and deploys to the dev Vercel project; `main` is
production. Session work goes worktree → PR → `dev` (`.claude/skills/ship`), and `dev` →
`main` is a deliberate promotion (`.claude/skills/promote`). Environments, variables and
what is applied where: [`docs/ENV-MATRIX.md`](docs/ENV-MATRIX.md). Handovers and the
rolling open-items list: [`docs/handovers/TRACKER.md`](docs/handovers/TRACKER.md).

## Database

Supabase migrations live in `supabase/migrations/` (timestamped names; `npm run
lint:migrations` rejects the old sequential form). `npm run db:status` shows what is
applied where. The schema of record for a fresh environment is `supabase/baseline.sql` +
`supabase/seed.sql` — see [`docs/SCHEMA-BASELINE.md`](docs/SCHEMA-BASELINE.md) for why the
chain does not replay from zero.

## Sanity Studio

Embedded at `/studio`. Access requires a Sanity account with write permission on the
project. Public-site content (events, news, team, testimonials, planned locations) is
authored there; the `event` document's slug is the join key to Supabase registrations.

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
