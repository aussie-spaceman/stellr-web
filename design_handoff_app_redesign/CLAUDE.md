# CLAUDE.md — stellr-web

> **Where this goes:** copy this file to the **repository root** (`stellr-web/CLAUDE.md`). Claude Code loads it automatically each session. The redesign spec lives in `design_handoff_app_redesign/` — read `README.md` there first, then `01_DESIGN_TOKENS.md`, `02_BUILD_PLAN.md`, `03_DATA_CONTRACTS.md`.

## What this project is
Stellr Education's web platform. A public marketing site (`www`) + an authenticated **member app** (`app.stellreducation.org`) that blends an LMS (Academy/Training), a community/forum (Spaces — circle.so-style), chat (Discord-style), events/competitions, mentoring & coaching, and member accounts.

**Primary design goal: ease of use** — members visit rarely (not daily/weekly), so every screen must be self-explanatory and answer "what do I do now?" Secondary: feel collaborative (a network), and look impressive.

## Stack & conventions
- **Next.js 14, App Router, TypeScript, RSC-first.** Pages are React Server Components by default; add `'use client'` only for interactivity (state, effects, event handlers).
- **Tailwind CSS** for all styling. Tokens in `tailwind.config.ts`; globals + `@font-face` + component classes in `styles/globals.css`.
- **Clerk** for auth (`@clerk/nextjs`). Server: `auth()`, `currentUser()`. The signed-in user maps to a `members` row via `members.clerk_user_id`.
- **Supabase** for app data, accessed **server-side only** via `supabaseServer()` (service-role). RLS is enabled but all access is gated in the server layer — never query Supabase from client components; go through route handlers / server functions in `lib/`.
- **Sanity** CMS for marketing content + the **events/campaigns catalog** (event docs; `event_ref` in Supabase is a Sanity `_id`).
- **lucide-react** for icons. **Stripe** for payments.
- Data-access helpers live in `lib/` (`community.ts`, `community-feed.ts`, `training.ts`, `event-portal.ts`, `sessions.ts`, …). **Reuse these — don't re-query tables inline.**

## Commands
```bash
npm run dev        # localhost:3000  (+ Sanity Studio at /studio)
npm run build      # production build — must pass before a PR is done
npx tsc --noEmit   # typecheck — must be clean
# NOTE: there is no `lint` script in package.json — build + tsc are the gates.
```
Env: copy `.env.local.example` → `.env.local` (Sanity, Supabase, Clerk, Stripe keys). Supabase migrations live in `supabase/migrations/`; seed for local/staging in `design_handoff_app_redesign/seed/`.

## Design rules (the redesign)
1. **Use the brand tokens — never raw Tailwind `gray-*`, `indigo-*`, `slate-*` in app UI.** Map to `brand-*` (see `01_DESIGN_TOKENS.md`). The app currently violates this everywhere; fixing it is the core of the work.
2. **Section color identity:** Competitions = orange `brand-orange-alt`, Community = `brand-blue`, Academy = gold `brand-orange`. Apply in nav, headers, badges, accents.
3. **Typography:** `font-display` (Archivo Black) for hero/numbers, `font-heading` (Norwester, UPPERCASE) for titles, `font-subheading` (Fredoka) for labels/buttons, `font-sans` (Aileron) for body. All already configured.
4. **People get faces:** render an avatar (photo or colored initials) anywhere a member name appears.
5. **App background** is warm canvas `#f4f1ea`, not `gray-50`. Cards are white, `rounded-2xl`, warm borders, soft shadow.
6. Keep all existing data logic and routes working — this is primarily a **styling + two structural additions** (Home route, sidebar). No schema changes required for the core.

## Working style
- Make changes in small, reviewable PRs that follow `02_BUILD_PLAN.md` order (tokens → global sweep → components → Home → sidebar → per-screen).
- Match existing file/component patterns before inventing new ones. Check neighboring files.
- Don't introduce new dependencies without need. Don't touch the `(admin)` surface unless a task says so.
- After each task: `npm run build` + `npx tsc --noEmit` (the repo has **no `lint` script**), and a visual check against the matching screen in `Stellr Design Review.dc.html`.
- The HTML in the handoff is a **visual reference**, not code to paste — recreate it idiomatically in Tailwind/TSX.
