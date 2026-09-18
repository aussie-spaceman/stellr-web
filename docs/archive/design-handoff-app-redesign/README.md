# Handoff: Stellr Member App — Look & Feel Redesign

## Overview
This package specifies a visual redesign of the **member web app** (`app.stellreducation.org`) — the authenticated `(member)` surface of the `stellr-web` Next.js codebase. The goal is to fix three problems found in the current build:

1. **The brand is defined but never applied in the app.** Screens use default Tailwind grays + stray `indigo`; the brand navy/blue/gold/orange (already in `tailwind.config.ts`) is essentially unused.
2. **There is no "Home."** Members land on `/community` (a flat Spaces list) with no sense of what to do next. This redesign adds a Home/dashboard and a persistent sidebar.
3. **It's impersonal and flat** — no avatars, no typographic hierarchy, no progress/presence cues.

The redesign is achievable mostly as a **styling pass + two new structural pieces** (a Home route and a sidebar nav). No backend/schema changes are required for the core work.

## Package contents (read in this order)
1. **`CLAUDE.md`** — copy to the **repo root**; Claude Code auto-loads it. Stack, conventions, commands, design rules.
2. **`01_DESIGN_TOKENS.md`** — paste-ready `tailwind.config.ts` + `globals.css` diffs, section color map, and the global gray→brand find/replace table.
3. **`02_BUILD_PLAN.md`** — ordered tasks (≈one PR each), per-screen loading/empty/error/locked states, and the Definition-of-Done checklist.
4. **`03_DATA_CONTRACTS.md`** — which `lib/` helper + fields feed every screen.
5. **`04_AGENT_NOTES.md`** — read-first file map, do-not-touch guardrails, self-verification grep commands, icon map, contrast pairs, PR hygiene.
6. **`PROMPTS.md`** — copy-paste prompts for Claude Code, one per PR, in order.
7. **`claude-settings.example.json`** — recommended `.claude/settings.json` permissions so the agent can build/lint/grep freely but asks before out-of-scope edits.
8. **`reference_components/`** — idiomatic TSX to recreate: `AppSidebar.tsx`, `HomeDashboard.tsx`, `ProgressRing.tsx`, `Avatar.tsx`.
9. **`seed/`** — `seed.sql` (Supabase) + `sanity-event.ndjson` + `seed/README.md`: dev data matching the mockups exactly.
10. **`Stellr Design Review.dc.html`** — the visual reference (open in a browser). `assets/` holds the logo + photo.
11. **`screenshots/`** — section-by-section PNG captures of the reference (visual targets the agent can read), indexed in `screenshots/README.md`.

> Suggested kickoff prompt for Claude Code: *"Read `CLAUDE.md`, then `design_handoff_app_redesign/README.md`, `01_DESIGN_TOKENS.md`, `02_BUILD_PLAN.md`, `03_DATA_CONTRACTS.md`, `04_AGENT_NOTES.md`. Summarize the plan and design rules back to me and list the files you'd touch for Stage 1 — don't write code yet."* Then drive it with `PROMPTS.md`, one PR at a time.

## About the Design Files
The file in this bundle (`Stellr Design Review.dc.html`) is a **design reference created in HTML** — a prototype showing the intended look, palette, type, and layout. **It is not production code to copy directly.** The task for Claude Code is to **recreate these designs inside the existing `stellr-web` environment** (Next.js 14 App Router + Tailwind CSS + TypeScript), using the project's established patterns, the existing brand tokens, and the existing component structure.

The HTML reference uses inline styles and a couple of placeholder/sample content items (e.g. "Lunar Settlement Challenge", member names) — these are illustrative. Wire real data from the existing Supabase/`lib` helpers (`getHomeFeed`, `getMemberEvents`, `listModules`, `getSpaceUnreadCounts`, etc., which already exist).

## Fidelity
**High-fidelity.** Colors, typography, spacing, and layout are intentional and final-direction. Recreate them with Tailwind utilities mapped to the existing `brand-*` tokens. Exact hex values are listed under **Design Tokens**.

## Design Tokens

### Colors — all already in `tailwind.config.ts` (`theme.extend.colors.brand`)
| Token | Hex | Use |
|---|---|---|
| `brand-blue-dark` (Navy/Ink) | `#051535` | Dark surfaces (sidebar, hero footers), headings, primary text |
| `brand-blue` | `#0d439d` | Primary actions, links, **Community** section identity |
| Bright blue *(add)* | `#1d5fd6` | Interactive highlights, hover, secondary avatars |
| `brand-orange` (Gold) | `#dda33b` | Achievement, progress rings/bars, **Academy** section identity |
| Gold-on-white text *(add)* | `#b67a1e` | Gold used as text on white (accessible contrast) |
| `brand-orange-alt` (Orange) | `#da6220` | High-energy CTAs, **Competitions** section identity, "new" badges |
| Orange-deep *(add, for gradients)* | `#c2410c` | End stop of orange gradients |
| Warm Canvas *(add)* | `#f4f1ea` | **App background** (replaces `bg-gray-50`) |
| Surface | `#ffffff` | Cards |
| Warm border *(add)* | `#e7e2d6` | Card borders (replaces `border-gray-200`) |
| Warm hairline *(add)* | `#f0ece1` | Inner dividers |
| Muted text *(add)* | `#5b5648` / `#8a8472` | Body-muted / captions (warm, replaces cold gray-500/400) |

**Recommended:** add the four "*(add)*" neutrals + bright blue as `brand-ink`, `brand-canvas`, `brand-border`, `brand-hairline`, `brand-muted`, `brand-blue-bright` in `tailwind.config.ts` so the whole app can drop `gray-*` usage.

### Section color mapping (wayfinding — apply consistently in nav, headers, cards, badges)
- **Competitions** → orange `#da6220`
- **Community** → blue `#0d439d`
- **Academy** → gold `#dda33b` (text form `#b67a1e`)

### Typography — all four faces already loaded in `styles/globals.css`
| Role | Family | Notes |
|---|---|---|
| Hero / big numbers | **Archivo Black** | e.g. "Welcome back, Avanee" h1 ~34px; cover ~74px |
| Screen & section titles | **Norwester** | UPPERCASE, letter-spacing ~.01–.02em; ~30–40px |
| Subheadings, labels, chips, buttons | **Fredoka** | weight 500–600; the friendly/youthful voice |
| Body & UI text | **Aileron** | weights 300/400/600/700 |

Current code applies Norwester to `h1–h6` globally but caps everything at `text-2xl`. Introduce a real scale and **use Archivo Black + Fredoka** (currently never used in-app). Map to Tailwind `font-display` (Archivo Black), `font-heading` (Norwester), `font-subheading` (Fredoka), `font-sans` (Aileron) — these aliases already exist in `tailwind.config.ts`.

### Radius, shadow, spacing
- Card radius: **16px** (`rounded-2xl`); hero/large cards **18px**; pills/buttons **11px** (`rounded-xl`); chips **20px** (`rounded-full`).
- Card shadow: `0 1px 3px rgba(10,23,51,.05)`; floating/browser frame `0 30px 70px -20px rgba(5,21,53,.4)`.
- Card padding: 20–30px. Section padding: 56–66px. Grid gaps: 18–24px.
- Avatars: 24/36px circles, initials, 2px white ring when overlapping (`-ml-[10px]`).
- Progress ring: SVG `r=16 strokeWidth=4`, track `#f0ece1`, fill `#dda33b`, `rotate(-90deg)`.

## Screens / Views

### 1. Home / "Today" — **NEW route** (the flagship)
- **Purpose:** First screen after sign-in. Answers "what's happening and what do I do next?" Replace the current landing (`/community`) as the default member destination; redirect post-auth here.
- **Suggested route:** `app/(member)/home/page.tsx` (or `app/(member)/page.tsx`).
- **Layout:** Two-column app shell — fixed **sidebar 228px** (navy `#051535`) + fluid main content (padding 30–32px) on canvas `#f4f1ea`. Min-height full.
- **Components:**
  - **Sidebar:** logo-icon (28–30px) + "STELLR" in Norwester 20px; nav items in Fredoka 500/15px with a section color swatch each; active item = `rgba(255,255,255,.10)` rounded 10px. Footer: current user avatar chip (gold circle, name + school). **Full destination set (repo-drift — the app grew past the original 5-item mock):** Home, Competitions; **Community group** → Spaces, Resources, Directory; **Academy group** → Training, Mentoring, Coaching, and **Hosting (conditional** on `canHost`/`showHosting`). The desktop rail groups the Community and Academy sub-items (indented); the mobile bar keeps 5 primary tabs (Home, Competitions, Community, Academy, Directory) with the rest reached from each section landing page. See the updated `reference_components/AppSidebar.tsx`.
  - **Header row:** "Welcome back," (Fredoka 500, muted) + first name in **Archivo Black 34px** `#051535`; right side notification + search buttons (40px, white, `border #e7e2d6`, radius 10px).
  - **Next-event hero card:** full-width, `linear-gradient(115deg,#da6220,#c2410c)`, radius 18px, white text, faint logo-icon watermark bottom-right (opacity .12, inverted). Contents: pill "Your next competition" + "in N days"; title in Norwester uppercase 27px; date/venue/team line (`#ffe6d6`); inline prep-checklist progress bar (white on `rgba(255,255,255,.25)`) + white "View event hub →" button (text `#c2410c`).
  - **Two-column row:** "Finish your training" card (gold accent, 2 module rows each with a progress ring + title + meta) and "Upcoming sessions" card (date chips colored by source — gold for Academy/mentoring, blue for Community — + title + time).
  - **"What's new in your spaces" card:** blue dot + Fredoka title + "View all →"; rows = colored initial avatar + "<b>Name</b> replied in <span blue>Space</span>" + snippet + relative time. Mentors tagged "(Mentor)" with orange avatar.
- **Data:** reuse `getMemberEvents`, `getAssignedModules`/`listModules`, `getHomeFeed`, session helpers, `getSpaceUnreadCounts`.

### 2. Community → Spaces — restyle existing `app/(member)/community/page.tsx`
- Keep the data and structure. Change: Community blue dot + "COMMUNITY" eyebrow (Fredoka uppercase) above a **Norwester** "Spaces" title; subtitle surfaces unread count ("your spaces have N new posts").
- Space cards: white, radius 12px, **4px left border in `#0d439d`**, shadow; header = Fredoka 600 name + orange "N new" pill (`#da6220`); description in muted; footer = overlapping member avatars + "+N members". Locked/tier-gated cards: `#fbf8f1` bg, muted title, lock glyph, gold "Unlock with membership →" link (replaces the current amber text).

### 3. Academy → Training — restyle existing `app/(member)/community/training/page.tsx`
- Replace the gray `from-gray-900 to-gray-700` module covers with **section-colored gradient covers**: Curriculum `linear-gradient(120deg,#0d439d,#1d5fd6)`, CTE `…(#da6220,#c2410c)`, Library `…(#051535,#0d439d)`.
- Keep the `ProgressRing` component but recolor: track `#f0ece1`, fill **`#dda33b`** (not `text-gray-900`/`green-500`). "Mandatory" badge stays orange `#da6220`. Section headers in Fredoka, kept.

### 4. Navigation shell — replace top-nav dropdowns in `components/layout/AppHeader.tsx`
- Current: top bar with 3 hover dropdowns (Competitions / Community / Academy). Replace (on member routes, in `app/(member)/layout.tsx`) with a **persistent left sidebar** as specified in Home. Expose all destinations as flat, color-coded items — no hover-to-discover. Keep search + notification bell + Clerk user button (move into sidebar footer or a slim top strip). On mobile: sidebar collapses to a bottom tab bar (4–5 colored icons, see mobile mock in the reference).

### 5. Mobile
- Both devices matter. Home stacks single-column: navy header (welcome + Archivo Black name), orange next-event card, training card, spaces card, **bottom tab bar** with the section color icons. Card radii 14–15px, tighter padding (13–15px). See the phone frame in the design reference.

## Interactions & Behavior
- **Sidebar nav:** active route highlighted (`rgba(255,255,255,.10)`); section swatch always visible. Mobile = bottom tab bar, active tab in section color.
- **Hover:** cards lift `translateY(-2px)` + border darkens + `shadow-md` (the training page already does this — extend pattern). Buttons darken one step.
- **Progress rings/bars:** animate `stroke-dashoffset` / width on mount (~600ms ease-out) — optional delight.
- **Empty states:** keep existing logic; restyle with brand muted text + a faint logo-icon glyph instead of gray lucide icons.
- **Responsive:** sidebar ≥1024px; bottom tab bar below. Content max-width ~1180px.

## State Management
No new global state required for the styling pass. Home aggregates server-fetched data (RSC, same as existing pages). Sidebar active state from `usePathname()` (already used in `AppHeader`). Mobile nav open/close = local `useState` (pattern already in `AppHeader`).

## Assets
Included in `assets/` of this bundle — all originate from the repo's `public/` and need no new sourcing:
- `logo-icon.svg` — star mark (repo: `public/images/logo-icon.svg`). Invert to white on navy via `filter:brightness(0) invert(1)`.
- `logo-horiz.svg`, `logo-vert.svg` — wordmark variants (`public/images/`).
- `hero-stem.jpg` — real competition photo (downscaled from `public/images/hero-stem.JPG`), usable for event hubs / marketing-style headers.
- Fonts already in `public/fonts/` (Norwester, Aileron family) + Archivo Black & Fredoka via the existing Google Fonts `@import` in `globals.css`.
- Icons: project already uses **lucide-react** — keep it.

## Files
- **Design reference (this bundle):** `Stellr Design Review.dc.html` — open in a browser to see all screens, the palette, type system, and before/after.
- **Repo files to create/modify:**
  - `tailwind.config.ts` — add neutral + bright-blue tokens (see Design Tokens).
  - `app/(member)/layout.tsx` — swap `bg-gray-50` → canvas; render sidebar instead of `AppHeader` dropdowns.
  - `app/(member)/home/page.tsx` — **new** Home dashboard.
  - `components/layout/AppSidebar.tsx` — **new** persistent nav (desktop) + bottom tab bar (mobile).
  - `app/(member)/community/page.tsx` — restyle Spaces.
  - `app/(member)/community/training/page.tsx` — colored covers + gold ring.
  - `components/community/ChatPanel.tsx` — recolor bubbles (own = `brand-blue`, others = warm hairline) instead of `bg-gray-900`/`gray-100`.
  - Member directory, posts, comments — add avatars wherever a name is shown.
- **Global find/replace candidates:** `bg-gray-50`→canvas, `border-gray-200`→`brand-border`, `text-gray-900`→`brand-ink`, `text-gray-500/400`→muted tokens, `indigo-*`→`brand-blue`, `bg-gray-900` (buttons/bubbles)→`brand-blue`.
