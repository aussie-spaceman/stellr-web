# 04 · Agent Notes — making Claude Code's output land first time

Everything in here is to reduce wrong guesses. Referenced from `CLAUDE.md` and the per-session kickoff prompt.

## A) Read these files BEFORE editing (ground truth)
When a task touches an area, read the real source first — don't work from the spec alone:

| Working on… | Read first |
|---|---|
| Tokens / styling | `tailwind.config.ts`, `styles/globals.css` |
| Nav / shell | `app/(member)/layout.tsx`, `components/layout/AppHeader.tsx`, `components/layout/Logo.tsx`, `components/layout/NavUserButton.tsx`, `components/layout/AppSearch.tsx` |
| Home (new) | `lib/community.ts`, `lib/community-feed.ts`, `lib/event-portal.ts`, `lib/training.ts`, `lib/sessions.ts` |
| Spaces | `app/(member)/community/page.tsx`, `app/(member)/community/[spaceSlug]/page.tsx`, `lib/community.ts` |
| Training | `app/(member)/community/training/page.tsx`, `lib/training.ts` |
| Directory | `app/(member)/community/members/page.tsx` |
| Chat | `components/community/ChatPanel.tsx` |
| Account | `app/(member)/account/page.tsx` + `components/member/*` |
| Auth/redirects | `proxy.ts` (repo root — **renamed from `middleware.ts`** in the Next 16 upgrade; holds the post-auth `/community` redirect at ~line 36), `app/(member)/community/layout.tsx`, `app/(member)/account/onboarding/page.tsx` |

## B) Guardrails — do NOT touch without explicit instruction
- `app/(admin)/**` and `components/admin/**` — out of scope for the redesign.
- Database schema / `supabase/migrations/**` — the redesign needs **no** schema change. If you think one is needed, stop and ask.
- Data-access logic in `lib/**` — restyle the views, but don't change query shapes, gating (`memberMeetsTier`/`memberCanAccess`), or return types unless a task says so.
- Auth, Stripe, Sanity client config, env handling.
- Don't add dependencies without asking. Don't rename routes (except adding `/home` and the post-auth redirect).
- Keep `data-comment-anchor` and any analytics attributes if present.

## C) Self-verification (run after each PR — you can't see the screen, so prove it with greps)
```bash
# 1. Brand sweep complete — these should return NOTHING in member UI:
rg -n "gray-(50|100|200|300|400|500|600|700|800|900)|indigo-|slate-|amber-" app/\(member\) components --glob '!**/admin/**'

# 2. Brand fonts are actually used (should return matches):
rg -n "font-display|font-heading|font-subheading" app/\(member\) components

# 3. No client-side Supabase in components (server-only data):
rg -n "createBrowserSupabase|supabaseServer" components   # supabaseServer must NOT appear in client components

# 4. Build + types + lint:
npm run build && npx tsc --noEmit && npm run lint
```
Paste the grep output into the PR so a human can confirm without running it.

## D) Icon map (lucide-react — already a dependency)
| Use | Icon |
|---|---|
| Home / nav | `Home` |
| Competitions / nav + events | `Trophy`, `CalendarDays` (live event), `Repeat` (campaign) |
| Community / nav + spaces | `MessagesSquare`, `MessageSquare` (comment count) |
| Academy / nav + training | `GraduationCap`, `BookOpen` (lessons), `Layers` (sections) |
| Directory / members | `Users` |
| Locked / tier-gated | `Lock` |
| Announcement / pinned | `Megaphone`, `Pin` |
| Search / notifications | `Search`, `Bell` |
| Completion | `CheckCircle2`, `Check` |
| Due / warning | `AlertCircle` |
Keep icon sizes ~16–20px (`h-4`/`h-5`); color from the section map, never raw gray.

## E) Accessibility & contrast pairs (use these combinations)
| Foreground | On background | OK for |
|---|---|---|
| `#ffffff` | `#051535` navy, `#0d439d` blue, `#da6220` orange, `#c2410c` | body + headings |
| `#051535` ink | `#f4f1ea` canvas, `#ffffff`, `#dda33b` gold | body + headings |
| `#b67a1e` gold-ink | white / canvas | gold-colored TEXT (never use `#dda33b` for text on white — fails contrast) |
| `#5b5648` muted | white / canvas | secondary text (passes AA at 14px+) |
| `#8a8472` muted-soft | white / canvas | captions only (≥12px, decorative/metadata) |
Other rules: focus-visible ring on all interactive elements (`focus:ring-2 focus:ring-brand-blue`); touch targets ≥44px on mobile; don't encode meaning in color alone (pair the section color with its icon/label); respect `prefers-reduced-motion` for the optional ring/bar animations.

## F) Commit / PR hygiene
- One PR per task id (`T1.1`, `T2.2`, …); title `redesign(Tn.n): <summary>`.
- Body: what changed, the grep/build output from §C, and a line on states covered (loading/empty/error/locked).
- Keep diffs presentational where the task says so — flag any behavioral change explicitly for human review (especially the nav swap and the post-auth redirect in T2.1/T2.2).
