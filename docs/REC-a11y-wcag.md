# REC — WCAG 2.1 AA Audit of Public Pages (F-23)

**Date:** 2026-07-03 · **Scope:** static code audit of `app/(public)/**` (~26 routes), shared chrome (`components/layout/`), and public section/form components. No browser testing performed — findings are grounded in the actual source.

## What's already done well

- Every public page renders inside a `<main>` landmark (`app/(public)/layout.tsx:8`), the root layout sets `lang="en"` (`app/layout.tsx:45`), the nav has `aria-label="Main navigation"` (`components/layout/Navbar.tsx:157`), and the footer is a real `<footer>` (`components/layout/SiteFooter.tsx`).
- Forms are properly labelled: ContactForm, JoinNetworkForm, ScholarshipForm, WhitePaperGate and AssetGate all use `<label htmlFor=…>` — no placeholder-only fields except one (see P1-3).
- Two modals are exemplary: **AssetGate** (`components/sections/AssetGate.tsx:66-95`) and the **ProofStrip lightbox** (`components/sections/ProofStrip.tsx:42-70`) both have `role="dialog"`, `aria-modal`, Esc-to-close, a real Tab focus trap, and focus restore. These are the in-repo pattern to copy.
- Images consistently carry descriptive alt text (e.g. `alt={`${founder.name}, ${founder.role}`}` in `app/(public)/about/page.tsx:286`); the one empty `alt=""` (VideoTestimonial poster) is genuinely decorative.
- Carousel dots/arrows are real `<button>`s with `aria-label`s; the mobile hamburger has `aria-label` + `aria-expanded` (`Navbar.tsx:266-267`).
- All h1 checks pass: every big page gets exactly one `<h1>` via the shared Hero (`packages/web-ui/src/Hero.tsx:57`) or locally; no h2→h4 skips found on home, /why-stellr, /membership.

## P1 — Blockers

1. **Desktop nav dropdowns are mouse-only.** In `components/layout/Navbar.tsx:168-205`, the pillar buttons (Educate, Community, Academy…) open their menus only via `onMouseEnter`/`onMouseLeave` — the `<button>` has `aria-expanded` but **no `onClick`, no keyboard handler, and doesn't navigate anywhere**. A keyboard user can Tab to "Educate" and press Enter and nothing happens; every dropdown destination (and the pillar landing pages themselves) is unreachable from the primary nav. Same pattern for "Get Involved" (`Navbar.tsx:216-231`). Fails WCAG 2.1.1 (Keyboard). Fix: toggle on click/Enter, close on Escape and blur-out, add `aria-haspopup="menu"`.
2. **White-paper modal has no dialog semantics or focus management.** `components/sections/WhitePaperGate.tsx:71-97` (the /impact lead-capture modal, live since 23-Jun) renders a fixed overlay with no `role="dialog"`, no `aria-modal`, no Escape handler, no focus trap, and no focus restore on close. Screen-reader and keyboard users can tab straight out into the page behind it. Fails 2.4.3 / 4.1.2. Fix: reuse the AssetGate pattern from the same directory.
3. **Newsletter input is placeholder-only.** `components/forms/SubscribeForm.tsx:34-41` — the email input has `placeholder="your@email.com"` but no `<label>` or `aria-label`. Fails 3.3.2 / 4.1.2. One-line fix: `aria-label="Email address"`.

## P2 — Serious

4. **Color contrast (computed from `styles/tokens.css`):**
   - **Donate button: white on `--color-donate-gold` #E0A23A ≈ 2.2:1** — clear fail at 14.5px semibold (`Navbar.tsx:256` and mobile `:312`). Needs a darker gold (the existing hover `#C9892C` ≈ 2.9:1 still fails) or dark text.
   - **"Join Free →": `--color-primary` #3C6DF6 on `--color-midnight` #0E1330 ≈ 4.1:1 at 13px** (`Navbar.tsx:143`) — fails 4.5:1 for small text.
   - **White on primary #3C6DF6 ≈ 4.46:1** — a hair under 4.5:1; fine for large/bold headings and big CTAs, borderline for the many small white-on-blue buttons (`.btn-primary` in `styles/globals.css:108`, Hero CTAs). Darkening primary buttons toward `--color-primary-deep` #2C53C6 (≈ 7.0:1) fixes it wholesale.
   - **`--color-text-faint` #8A90AD on white ≈ 3.15:1** — fails for normal text; `text-content-faint` has ~81 usages across public pages/components, often at 13px meta size. `--color-text-muted` #6A708C (4.87:1) passes and is the easy swap.
5. **Mobile accordion buttons lack `aria-expanded`** (`Navbar.tsx:281-290`) — state changes are invisible to screen readers (desktop pillars and hamburger do set it, so this is an omission, not a pattern gap).
6. **Auto-advancing carousels can't be paused.** `components/sections/StudentWorkHero.tsx:38` auto-rotates on `setInterval` with no pause control and no hover/focus pause; `components/sections/QuoteRotator.tsx:25-31` pauses on hover but not on keyboard focus. Fails 2.2.2 (Pause, Stop, Hide). Neither respects `prefers-reduced-motion`.

## P3 — Polish

7. **No skip link.** Nothing matching "skip to content" anywhere in `app/` or `components/`; keyboard users must tab through the whole nav (incl. dropdowns, once fixed) on every page. Add an sr-only-until-focused link before `<SiteHeader />` in `app/(public)/layout.tsx`.
8. **`prefers-reduced-motion` only gates two animations** (`styles/globals.css:142` — ring/bar fills). Carousel auto-advance and transition effects aren't covered.
9. **Focus-visible styling is partial**: the `.btn-*` classes have solid `focus:ring` styles (`globals.css:104-136`), but bespoke Tailwind buttons/links (nav pillars, dropdown items, utility-bar links) rely on browser defaults with `focus:outline-none` nowhere added — acceptable, but a global `:focus-visible` ring would make keyboard focus consistently visible on the dark header.

## Recommended next step

Fix the three P1s in one small PR (keyboard-operable nav dropdowns copying nav-menu semantics, retrofit WhitePaperGate with the AssetGate focus-trap pattern, `aria-label` on SubscribeForm), then a follow-up token pass for the four contrast pairs in P2-4. **Effort: M overall** (P1s alone: S — roughly a half-day; contrast pass: S but needs a design sign-off on the darker gold/blue).
