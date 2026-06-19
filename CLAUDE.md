# CLAUDE.md — Stellr Education front-end

Binding context for any AI/dev work in this repo. Read before writing UI.

## Design System V2 is the default — always
All UI across every surface (public site `www`, web app `app`, admin, and future
desktop/mobile) uses the **Stellr Design System V2** (Claude Design). Do not
invent colours, type, spacing, radii, or shadows. The pre-V2 warm-navy /
Norwester system is retired.

### Tokens are the single source of truth
- Source: **`design/tokens.json`** (W3C DTCG format).
- Build: `npm run build:tokens` → `styles/tokens.css` (CSS custom properties) +
  `lib/tokens.ts` (typed object). `tailwind.config.ts` imports `lib/tokens.ts`,
  so Tailwind utilities and runtime CSS share one source. Regenerated on every
  build via `prebuild`.
- **Never hard-code** raw hex, off-scale px for the type/space/radius scale, or
  font-family names in component code. Use the Tailwind token utilities
  (`bg-primary`, `text-ink`, `border-line`, `bg-surface`, `text-space-violet`,
  `rounded-ds-card`, `shadow-featured`, `max-w-content`, …).
- If a value you need doesn't exist, **add it to `design/tokens.json` and
  rebuild** — don't inline it. (Hero tints `midnightDeep/heroLead/heroDim` were
  added this way.)

### Components come from the shared library
- Web (public site, web app, desktop): import from **`@stellr/web-ui`**
  (`packages/web-ui`). Don't re-implement: `Button`, `Eyebrow`, `Badge`,
  `SectionHeading`, `InfoPill`, `Hero`, `CtaBand`, `StepCard`, `PathwayCard`,
  `ThemeCard`, `TierCard`, `ProgressionGraphic`.
- Icons: import from **`@stellr/icons`** (`packages/icons`) — the 24px line set,
  `currentColor`, ~1.8px stroke. Don't paste raw SVG.
- Components are framework-light: pass the router's link via `as`/`linkAs`
  (e.g. `<Button href="/events" as={Link}>`), don't hard-wire `next/link`.
- New UI extends the library; it does not fork it. Browse it in Storybook:
  `npm run storybook`.

## Type
- Display / headings: **Space Grotesk** (`font-display` / `font-heading`).
- Body / UI: **Hanken Grotesk** (`font-sans` / `font-subheading`).
- Competition print/slide materials only: **Norwester / Aileron** via
  `font-competition` / `font-competition-body`. Never use these for site UI.

## Layout
- Content column `max-w-content` (1080px); header/footer chrome `max-w-chrome`
  (1240px). Dark `midnight` hero, light `surface`/white body. Colour codes
  meaning: theme = space-violet / enviro-green, pathway = primary / pathway-amber,
  action = primary, support = gold.

## Principles
1. **Comprehension first** — sequence decisions one axis at a time.
2. **Dark hero, light body.**
3. **Consistent vocabulary** — tier/program names match across every page.
4. **Earn every element** — no filler stats or icons.

## Voice & copy
- Follow **`VOICE.md`** for tone, the per-context Tone table, and per-audience
  guidance. Write all user-facing copy in-brand.

## Enforcement
- `npm run lint:tokens` (runs in `prebuild`, so it gates the build) fails on
  pre-V2 brand hex literals and old font-family names in `app/**` (excl.
  `app/api`), `components/**`, `packages/**`. Keep the build green by using
  tokens.

## Reference
- Storybook (`npm run storybook`) is the living component reference.
- Handoff source: `design_handoff_competitions_page V2/` — `Stellr — Design
  System.dc.html` (visual reference) and `Competitions — Redesign v2.dc.html`
  (a full page built in the system).
