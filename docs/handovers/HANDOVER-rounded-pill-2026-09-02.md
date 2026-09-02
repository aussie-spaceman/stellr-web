# Handover — `rounded-pill` utility fix (2 Sept 2026)

**Status: SHIPPED + DEPLOYED + PROD-VERIFIED.** Commit `d55e7bf` on `main`.
No follow-up work is required for the fix itself. Read §4 before touching design tokens.

---

## 1. What was wrong

`design/tokens.json` defines `radius.pill` (999px) and it reached `lib/tokens.ts`
as `tokens.radius.pill`, but `tailwind.config.ts` never added `pill` to its
`borderRadius` extend block (it wired only `control`, `ds-card`, `panel`, `cta`
plus legacy `card`/`card-lg`). So Tailwind generated **no `.rounded-pill`
utility at all** and every call site rendered with square corners.

## 2. The fix

One line in `tailwind.config.ts:117`:

```ts
'pill':    tokens.radius.pill,
```

`npm run build:tokens` was run and was a **no-op** — `lib/tokens.ts` and
`styles/tokens.css` already carried `pill`. Only the Tailwind wiring was missing.
Do not expect a token-build diff if you redo this.

## 3. Scale — the brief understated this by ~50x

The task described 2 affected components. The real blast radius was
**97 call sites across 35 files**:

| Area | files |
|---|---|
| `components/community` | 9 |
| `app/(member)` | 8 |
| `components/admin` | 6 |
| `components/campaigns` | 4 |
| `app/(admin)` | 4 |
| `packages/web-ui` | 1 |
| `components/sections` | 1 |
| `components/interactive` | 1 |
| `app/(public)` | 1 |

Two premises in the brief were **wrong** and are worth not re-deriving:

- **`Badge` (`packages/web-ui/src/primitives.tsx:94`) has ZERO app call sites.**
  Its only usage anywhere is `packages/web-ui/src/primitives.stories.tsx`
  (Storybook). The brief said "this changes Badge everywhere it is used" and that
  `/competitions` and `/membership` "use Badge heavily" — they do not use it at all.
  `Badge` is currently dead code. See §5.
- **`/membership` renders zero `.rounded-pill` elements** and was completely
  unaffected. It was named as a priority page to check; it did not change.

`ProgressionGraphic` (`packages/web-ui/src/competition.tsx:288`) uses
`rounded-full`, was already correct, and was untouched — the brief's hunch here
was right.

## 4. The generalised bug — checked and CLOSED

Root cause class: *a token exists in `design/tokens.json` but is never wired into
`tailwind.config.ts`, while code uses it as a Tailwind class.*

**21 other leaf tokens are also unwired** (all of `bracket.*`, `tier.*`,
`space.section`, `space.gutter`). **These are NOT bugs.** They are consumed as CSS
custom properties via `var(--tier-catalyst)`, `var(--bracket-school-deep)` etc. in
`packages/web-ui/src/tier-shades.tsx`, which is a working, intentional path.

Verified there are **no class-style usages** of any of them
(no `bg-tier-*`, `text-bracket-*`, `py-section`, `px-gutter`, …).

**`radius.pill` was the only token consumed as a Tailwind class without being
wired.** There is no second instance of this bug. Do not re-audit this.

Reproduce the check:

```bash
grep -rnoE "\b(bg|text|border|from|to|via|ring)-(tier|bracket)-[a-zA-Z]+" . \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
grep -rnoE "\b(p|px|py|pt|pb|pl|pr|m|mx|my|gap)-(section|gutter)\b" . \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
```

Both must return nothing. If either ever returns a hit, that token needs wiring
into `tailwind.config.ts` the same way `pill` was.

## 5. Open item — dead `Badge` component (low priority, needs a decision)

`Badge` is exported from `@stellr/web-ui` and documented in
`docs/DESIGN-SYSTEM-V2-MEMBER-ADMIN-HANDOFF.md:67` as part of the public API, but
nothing imports it. It is now *correct* (renders a real pill) rather than
silently broken, so this is not urgent.

Decide one of:
- **Adopt it** — replace hand-rolled chip markup
  (`inline-flex items-center rounded-pill px-3 py-1 text-xs font-bold uppercase
  tracking-[0.05em] …`) with `<Badge>`. That exact string is duplicated across
  many of the 97 sites and is what `Badge` already encapsulates.
- **Delete it** — and remove it from the design-system handoff doc.

Leaving it as-is is also defensible; it is a documented DS primitive awaiting adoption.

## 6. Verification actually performed — and its limits

**Verified on prod (`www.stellreducation.org`), two independent ways:**
- Served CSS chunk `/_next/static/chunks/007g7mx08jm_0.css` contains
  `.rounded-pill{border-radius:999px}`.
- Live DOM: the `/competitions` attribution chip computes
  `border-radius: 999px` at 24x70px.

**Verified in dev at 1280px** with before/after screenshots (square box -> stadium
pill) and measured on 6 public pages: `/competitions`, `/about`, `/students`,
`/grant`, `/educators`, `/curriculum/atmospheric-requirements/teachers`.
All chips 24px tall, 57-248px wide, all `999px`.

**Verified at 375px:** `/students` and the curriculum teachers page only.

**Progress bars — empirically cleared.** The one category where 999px meets a
dynamic inline `width: X%`. Probed against the real compiled prod CSS at
0/1/2/5/25/100%: CSS clamps the radius proportionally, so a 1% fill renders as a
2.9x6px rounded nub. Nothing vanishes or malforms. 15 call sites, incl.
`AccessPanel.tsx:42-43`, `WorkshopSpace.tsx:276-277`, `CohortSpace.tsx:275-276`,
`ManageCohort.tsx:194,413`.

### What was NOT verified

- **32 of 35 files were never rendered in a browser** — all `app/(member)`,
  `app/(admin)`, `components/community`, `components/admin`, `components/campaigns`
  surfaces. They need auth. The audit for these was **static** (grep + reading
  class strings), not visual. Every one is a chip, small button, or progress bar
  wider than it is tall, so 999px is structurally correct — but no one has looked.
- **`/competitions` at 375px specifically.** The browser pane refused to hold the
  mobile viewport (reported `innerWidth: 583` right after a resize claimed 375,
  in a fresh tab too). Coverage is *inferred* from `/students`, which renders the
  identical `PullQuoteWall` chip. There are **no responsive `*:rounded-pill`
  variants** anywhere in the repo, so the radius cannot differ by breakpoint —
  the inference is sound, but it is an inference.

## 7. Gates

All pass on `main`:

```bash
npm run lint:tokens          # design-system lint: no pre-V2 brand regressions
npx tsc --noEmit             # clean
npm run check:deploy-ready   # working tree clean and branch pushed; 12/12 event slugs match
```

## 8. Concurrent-session note

This session did **not** push. A parallel session picked up `d55e7bf`, pushed it
to `main`, and switched the local checkout off `feat/landing-pages-2026-09-02`
onto `main`. Vercel auto-deployed from that push.

`d55e7bf` did not land alone — `6bae9c3` sits below it and `deb5f4e`, `e528c02`,
`bbb5d5c` above, all landing-page work from that other session, deployed in the
same window. **Those were not verified by this session.** If something on the
site looks wrong now, they are the likelier cause than a one-line border-radius.

Also of note: the dev server rewrote `next-env.d.ts`
(`./.next/types/` -> `./.next/dev/types/`). It was reverted so it stayed out of
the commit. Expect it to reappear whenever `next dev` runs; do not commit it.

## 9. Environment traps hit (all previously documented, all re-confirmed)

- The browser screenshot pane **blanks after any native scroll**. Workaround used:
  `document.body.style.transform = translateY(...)` to move content without
  scrolling, plus CSS `scale()` to magnify (the pane's `zoom` region-crop is
  **not supported** — it returns the full screenshot).
- **Mobile viewport emulation silently drifts.** Always assert
  `window.innerWidth` in the same call that reads geometry; a resize returning
  "Viewport set to 375x812" is not proof. A reload resets it.
- `scroll-behavior: smooth` is set globally — programmatic scroll reads taken
  <600ms after a `scrollTo` return stale positions and look like "scroll is broken".
- The Browser pane's `preview_start` resolves `.claude/launch.json` from the
  **session cwd** (the Google Drive dir), not the repo. Start `next dev` via Bash
  and use `navigate` instead.
- macOS has no `timeout` command; `npm run check:deploy-ready` takes ~1 min, run
  it with a generous tool timeout instead.
