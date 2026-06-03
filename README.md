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

## Sanity Studio

Embedded at `/studio`. Access requires a Sanity account with write permission on the project.  
Protect with Google OAuth in Sanity project settings before going live.
