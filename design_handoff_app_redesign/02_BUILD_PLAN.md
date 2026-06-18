# 02 · Build Plan — ordered tasks, states & acceptance criteria

Work top-to-bottom; each task is ~one PR. Don't start a stage until the prior one's acceptance criteria pass (`tsc --noEmit` + `lint` + visual check vs `Stellr Design Review.dc.html`).

---

## Stage 1 — Foundations (≈1 week)

### T1.1 Add design tokens
- Apply diffs A–C from `01_DESIGN_TOKENS.md` to `tailwind.config.ts` + `styles/globals.css`; add `lib/ui/sections.ts`.
- **Done when:** build passes; `bg-brand-canvas`, `shadow-card`, `font-display` resolve; no visual change yet beyond body bg.

### T1.2 Global monochrome → brand sweep
- Apply the find/replace map (diff D) across `app/(member)/**` and `components/**` (skip `(admin)`).
- Recolor `components/community/ChatPanel.tsx` bubbles: own message `bg-brand-blue text-white`, others `bg-brand-hairline text-brand-blue-dark`; send button `bg-brand-blue`.
- **Scale note (repo-drift):** this sweep is large in the current repo — **~81 files / ~2,380 occurrences** of `gray-*`/`indigo-*`/`slate-*`/`amber-*` in member UI. Do **not** ship it as one giant diff. Split into reviewable sub-PRs — e.g. **T1.2a `components/**`**, **T1.2b `app/(member)/**`** — and lean on the grep self-checks (§C in `04_AGENT_NOTES.md`) rather than eyeballing. Prefer token-for-token replacements (a class map) over hand-editing each file.
- **Done when:** no `gray-*`/`indigo-*`/`amber-*` utility classes remain in member UI (grep to confirm); every screen still renders the same layout, now on brand.

### T1.3 Typography pass
- Section/screen titles → `font-heading uppercase`; labels/chips/buttons → `font-subheading`; body stays Aileron. Introduce `text-display`/`text-title` where headings were `text-2xl`.
- **Done when:** Archivo Black + Fredoka actually appear in-app (currently never used); headings have real hierarchy.

### T1.4 Avatars everywhere
- Build `components/ui/Avatar.tsx` (photo if present, else colored initials; sizes sm/md/lg; `AvatarStack` for overlaps). Color from a stable hash of member id → brand palette.
- Use it in: member directory cards, post author lines, comments, chat, home feed.
- **Done when:** no name appears without an avatar; directory reads as people, not rows.

---

## Stage 2 — Structure (≈2–3 weeks)

### T2.1 Persistent sidebar nav
- New `components/layout/AppSidebar.tsx` (see `reference_components/AppSidebar.tsx`). Desktop ≥`lg`: fixed 228px navy rail, color-coded items, user chip footer. `<lg`: bottom tab bar.
- Wire into `app/(member)/layout.tsx` (replace the `AppHeader` dropdown nav on member routes; keep search + notification bell + Clerk button, relocated into the rail/top strip). Keep `AppHeader` for any non-member shells that still use it.
- **Cover ALL live destinations (repo-drift):** the app grew since the mock. The current `AppHeader` exposes **Spaces, Resources, Directory** (Community) and **Training, Mentoring, Coaching, Hosting** (Academy) — plus Competitions and the new Home. The updated `reference_components/AppSidebar.tsx` now groups these in the desktop rail and keeps 5 PRIMARY tabs on mobile. **Hosting is conditional** — pass a `canHost` prop computed server-side with the same logic as `AppHeader`'s `showHosting` (`session_hosts.can_mentor/can_coach`). Don't drop Resources/Mentoring/Coaching/Hosting.
- **Done when:** every destination the old dropdowns reached is reachable from the sidebar (no hover); active route highlighted in its section color; mobile shows a 5-item tab bar with 44px+ targets and secondary items reachable from each section landing page.

### T2.2 Home / "Today" route
- New `app/(member)/home/page.tsx` (RSC) per `reference_components/HomeDashboard.tsx`. Sections: next-event hero, training-to-finish, upcoming sessions, what's-new-in-spaces.
- Make `/home` the post-auth landing (update the redirect that currently targets `/community`). **The auth redirect lives in `proxy.ts` at the repo root** (~line 36, `redirect(new URL(userId ? '/community' : '/sign-in', ...))`) — the project renamed `middleware.ts` → `proxy.ts` in the Next 16 upgrade, so there is no `middleware.ts`. Also check the `app/(member)/account/onboarding` completion redirect.
- Wire real data via the helpers in `03_DATA_CONTRACTS.md`.
- **Done when:** a returning member sees next event + due training + sessions + activity in one view; empty states handled (below); no placeholder copy ships.

### T2.3 Card system refresh
- Extract `components/ui/Card.tsx` + the `app-card` class; refit Spaces, Training, Events, Directory to it (covers, progress, presence, section accents).
- **Done when:** cards are visually consistent (radius 16, warm border, soft shadow) and section-accented.

---

## Stage 3 — Screen refits (parallelizable after Stage 2)

### T3.1 Community → Spaces  (`app/(member)/community/page.tsx`)
Eyebrow + Norwester title; unread count in subtitle; space cards with blue left-accent, orange "N new" pill, member avatar stack; locked cards → gold "Unlock with membership".

### T3.2 Academy → Training  (`app/(member)/community/training/page.tsx`)
Section-colored gradient covers (Curriculum blue, CTE orange, Library navy); recolor `ProgressRing` to gold (`reference_components/ProgressRing.tsx`); keep mandatory/due badges (orange).

### T3.3 Member Directory  (`app/(member)/community/members/page.tsx`)
Avatar-led cards, school + region chips, role badge in section color; restyle filter bar with `input-field`.

### T3.4 Account  (`app/(member)/account/page.tsx`)
Tab bar active state → `brand-blue` (was indigo); section cards → `app-card`; membership card in navy/gold.

### T3.5 Event hub  (`app/(member)/community/events/[slug]/page.tsx`)
Orange-accented header (can use `assets/hero-stem.jpg` style imagery), prep checklist, materials list. Mirror the Home hero treatment.

---

## Stage 4 — Delight (later, optional)
First-run onboarding tour; post-event achievement moment; richer profiles/portfolios; mount animations on progress rings/bars; illustrated empty states using the star mark.

---

## Per-screen STATE coverage (build all of these, every screen)

| State | Requirement |
|---|---|
| **Loading** | RSC: stream with `loading.tsx` skeletons that match card shapes (warm `bg-brand-hairline` blocks). No layout shift. |
| **Empty** | Branded empty state: faint star-mark glyph + one-line guidance + a primary action. Replace the current gray-lucide empties. Each screen below has copy. |
| **Error** | `error.tsx` boundary per segment: short message + retry; never a raw stack. |
| **Locked / tier-gated** | Soft card (`bg-brand-canvas`/`#fbf8f1`), lock glyph, gold "Unlock with membership →" → `/account?tab=billing`. (Logic already exists via `memberMeetsTier`/`memberCanAccess` — restyle only.) |
| **Unread / new** | Orange pill ("N new"), bold title, blue unread dot — consistent token usage. |
| **Offline/realtime fallback** | ChatPanel already polls when realtime is unconfigured — keep; show the existing "N online" only when `onlineCount>0`. |

### Empty-state copy (use verbatim)
- **Home — no next event:** "No upcoming competitions yet." + button "Browse competitions" → `/events`.
- **Home — no training due:** "You're all caught up on training. 🎉" + link "Explore the library".
- **Home — no activity:** "Your spaces are quiet right now. Start a discussion →".
- **Spaces — none:** "No spaces yet. Check back soon." (keep).
- **Training — none:** "No training available yet. Check back soon." (keep).
- **Directory — none:** "No members found." + sub "Members must opt in from their account page to appear here." (keep).

## Acceptance checklist (Definition of Done, every PR)
- [ ] `npm run build`, `npx tsc --noEmit`, `npm run lint` all clean.
- [ ] No `gray-*` / `indigo-*` / `slate-*` / `amber-*` utilities in touched member files.
- [ ] Section color identity correct (Competitions orange / Community blue / Academy gold).
- [ ] Loading + empty + error + locked states implemented.
- [ ] Mobile (`<lg`) verified; touch targets ≥44px; bottom tab bar present.
- [ ] Matches the corresponding frame in `Stellr Design Review.dc.html`.
- [ ] Real data wired (no placeholder/sample copy from the mock shipped).
- [ ] No regression to existing routes/data logic.
