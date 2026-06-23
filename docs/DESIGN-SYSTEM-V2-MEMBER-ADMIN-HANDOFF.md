# Handoff: Redesign the Member App + Admin onto Design System V2

**Audience:** Claude Design (and any dev continuing the design-system rollout).
**Goal:** Bring `app.stellreducation.org` (the member web app) and the admin console
to full **Design System V2** fidelity, the way the public Competitions page already is.

> **Read first:** `/CLAUDE.md` (binding front-end rules) and `/VOICE.md` (copy voice).
> **Reference implementation:** `app/(public)/competitions/page.tsx` — a complete page
> built verbatim in V2. Copy its patterns.

---

## 0. What already exists (don't rebuild this)

`www` and `app` are **one Next app** — route groups, one `layout.tsx`, one
`globals.css`, one `tailwind.config.ts`:

| Route group | Surface |
|---|---|
| `app/(public)` | www. (marketing) — **owned separately; don't edit** |
| `app/(member)` | app. (member web app) — **your scope** |
| `app/(admin)`  | admin console — **your scope** |
| `app/(auth)`   | sign-in/up |

**Foundation is done and live across all route groups:**
- **Tokens** — `design/tokens.json` → `styles/tokens.css` + `lib/tokens.ts` via
  `npm run build:tokens` (Style Dictionary). `tailwind.config.ts` consumes them.
- **Brand swap** — colours/neutrals/fonts already flipped to V2 everywhere. The
  member app + admin are **already auto-rebranded** (bright `#3C6DF6` primary,
  cool `#F6F7FB` surface, Space Grotesk + Hanken Grotesk). 0 pre-V2 hex/fonts remain.
- **Component library** — `@stellr/web-ui` (`packages/web-ui`) + `@stellr/icons`
  (`packages/icons`), workspace packages, transpiled by Next.
- **Storybook** — `npm run storybook` (the living reference).
- **Lint guardrail** — `npm run lint:tokens` (runs in `prebuild`, gates the build):
  fails on pre-V2 brand hex or old font names in `app/**` (excl. `app/api`),
  `components/**`, `packages/**`.

**What's NOT done (your job):** the member app + admin are correctly *coloured* but
have **not** been refactored onto `@stellr/web-ui` and have **no per-page V2
fidelity pass** (page headers, hierarchy, component adoption, accent usage).

---

## 1. Ground rules (non-negotiable)

1. **Token-only.** No raw hex, no off-scale px for the type/space/radius scale, no
   bare font-family names in UI code. Use Tailwind token utilities. If a value
   doesn't exist, **add it to `design/tokens.json` and run `npm run build:tokens`** —
   never inline it. (`midnightDeep/heroLead/heroDim` were added this way.)
2. **Consume the library; extend, don't fork.** Import from `@stellr/web-ui` /
   `@stellr/icons`. New shared patterns become new components *in* `packages/web-ui`.
3. **Keep the library framework-light.** Inject the router link via `as`/`linkAs`
   (`<Button href="/x" as={Link}>`); don't import `next/link` inside `packages/web-ui`.
4. **Responsive always.** Every screen verified at **mobile 375 / tablet 768 /
   desktop 1280**. New shared components get Storybook stories with all three viewports.
5. **Don't break the build.** `npm run build` **and** `npm run build-storybook` must
   stay green; `npm run lint:tokens` must pass. Commit in reviewable slices.
6. **Stay out of `app/(public)`** — that's the marketing surface (separate owner /
   the reference). Member chrome (`App*`) is distinct from public chrome (`Site*`);
   don't cross them.

---

## 2. How to consume the system

```tsx
import { Hero, Button, Eyebrow, SectionHeading, Badge, TierCard /* … */ } from '@stellr/web-ui'
import { Launch, Team, Award } from '@stellr/icons'
```

**Token utilities** (full set in `CLAUDE.md` + `lib/tokens.ts`):
- Surfaces: `bg-surface` (canvas), `bg-white` (cards), `bg-midnight` (dark), `bg-ink`
- Text: `text-ink` (headings), `text-content-body`, `-secondary`, `-muted`, `-faint`
- Action: `text-primary` / `bg-primary` / `bg-primary-deep` / `bg-primary-soft`
- Lines: `border-line`, `border-line-light`
- Theme accents: `text-space-violet*`, `text-enviro-green*`, `pathway-amber*`
- Radius/shadow: `rounded-ds-card`, `rounded-panel`, `shadow-card`, `shadow-featured`
- Layout: `max-w-content` (1080), `max-w-chrome` (1240)
- Fonts: `font-display`/`font-heading` (Space Grotesk), `font-sans`/`font-subheading` (Hanken)

---

## 3. Scope

**Member app — `app/(member)` (19 pages):** `home` (dashboard), `account` (+ onboarding),
and the `community/*` cluster (spaces, posts, events, coaching, hosting, members,
mentoring, resources, search, sessions/room, training).
**Admin — `app/(admin)` (31 pages):** `admin` (dashboard), `members`, `schools`,
`events`, `store`, `membership`, `compliance`, `docusigns`, `email`, `delegations`,
`staff`, `activity-log`, and the `community/*` admin cluster.
**Shared chrome:** member = `components/layout/App{Header,Sidebar,TopBar,Footer,Search}.tsx`;
admin = `components/admin/AdminSidebar.tsx`. Per-screen components in
`components/member/**` (12) and `components/admin/**` (31).

> The IA/structure from the earlier `design_handoff_app_redesign/` package is still
> valid — but its **tokens are superseded by V2**. Treat its layout/flows as a starting
> point, its colours/fonts as replaced.

---

## 4. Recommended sequence

**Phase A — App shell first.** Redesign the chrome that frames every screen:
`AppSidebar`, `AppHeader`/`AppTopBar`, `AppFooter`, `AppSearch`, `AdminSidebar`.
Extract them into `@stellr/web-ui` as app-shell components (`AppShell`, `SidebarNav`,
`TopBar`) — these are **app chrome, distinct from the public `SiteHeader`**. Active-nav
= `primary`; surface canvas; white content area.

**Phase B — Promote the app's repeated primitives into `@stellr/web-ui`:**
`StatCard`/`MetricCard`, `DataTable` (admin tables), `Tabs`, `Drawer`/`Modal`,
`FormField`/`Input`/`Select`, `StatusPill`, `EmptyState`, `ProgressRing`, `Avatar`
(already token-clean). Add Storybook stories (3 viewports) for each. Member + admin
then share one set.

**Phase C — Page-by-page.** Member first (`home` dashboard → `account` → community
cluster → training), then admin (`admin` dashboard → `members` → `events` → `store` →
community admin → `membership` → compliance/misc). Each page: compose from `web-ui`,
apply the app hierarchy (below), verify 3 viewports, keep build green.

**Phase D — QA.** Storybook coverage complete; `lint:tokens`, `build`, `build-storybook`
all green; contrast checked (see §5).

---

## 5. App/admin design language (differs from marketing)

The public pages use **dark midnight heroes + airy sections**. The app/admin are
**utility-dense** — design accordingly:
- **No big marketing heroes on dashboards.** Use a compact page header (the
  `SectionHeading` pattern: eyebrow + H2), then content. Reserve `Hero`/`midnight`
  gradients for the occasional feature/empty-state moment, not every screen.
- **Surface hierarchy:** `bg-surface` page canvas → white cards (`app-card`:
  `rounded-card border-line shadow-card`) → `border-line-light` inner dividers.
  `text-ink` headings, `text-content-*` body.
- **Action vs status.** `primary` = actions/active nav/links. **Status colours stay
  semantic** — success → `enviro-green`, warning → `pathway-amber`, error → `danger`.
  **Do not** theme-map status colours to Space/Environmental accents.
- **Section wayfinding** (`lib/ui/sections.ts`): Competitions = amber, Community =
  primary/blue, Academy = gold. Use for module identity, not generic UI.
- **Theme accents** (`space-violet`, `enviro-green`) are for *competition theme*
  contexts only — not decoration.
- **Tables/forms:** row dividers `border-line-light`, zebra `bg-surface`, focus rings
  `ring-primary`. If you need table-specific tokens, add them to `tokens.json`.

---

## 6. Accessibility

- `#3C6DF6` (primary) on white is ~3.6:1 — **fails WCAG AA for body-size text.** Use
  `text-ink` or `text-primary-deep` (`#2C53C6`) for body-size blue text/links; reserve
  bare `primary` for large text, icons, fills, and UI chrome.
- Maintain visible focus rings (`focus:ring-2 ring-primary ring-offset-2`).

---

## 7. Per-PR checklist

- [ ] `npm run lint:tokens` passes (no pre-V2 hex/fonts)
- [ ] `npm run build` green · `npm run build-storybook` green
- [ ] New shared components live in `packages/web-ui` with 3-viewport stories
- [ ] Verified at mobile 375 / tablet 768 / desktop 1280
- [ ] No raw hex / off-scale px / bare font names; new tokens added to `tokens.json`
- [ ] `next/link` injected (not imported) inside `packages/web-ui`
- [ ] Didn't touch `app/(public)`

## 8. Repo gotchas

- One Next app — member chrome (`App*`) ≠ public chrome (`Site*`); keep them separate.
- `brand-*` Tailwind aliases are **remapped to V2** — existing member/admin code is
  already cool. Don't "fix" `brand-*` back to literal hex; migrate to semantic names
  (`primary`, `ink`, `surface`, …) opportunistically as you touch files.
- `#C2722A` (amber gradient end) appears as an arbitrary value; if you touch it,
  promote it to a `pathwayAmberDeep` token rather than spreading the literal.
- `next/image` SVGs need `dangerouslyAllowSVG` (already set in `next.config.mjs`).
- Deploy: Vercel Hobby caps crons at daily — deploy via `npx vercel deploy --prod --yes`.
- `storybook-static/` and generated `styles/tokens.css` / `lib/tokens.ts` are build
  outputs (regenerated by `prebuild`); don't hand-edit them.
