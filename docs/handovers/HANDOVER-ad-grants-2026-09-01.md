# Handover — Google Ad Grants website-policy remediation

**Date:** 1 September 2026
**Branches:** `fix/ad-grants-compliance-2026-09-01`, `fix/funding-note-copy-2026-09-01`,
`fix/impact-scholarship-copy-2026-09-01`, `fix/surplus-copy-2026-09-01` — all merged to `main`
**Merges:** `a0e7f0b` → `4c32703` → `547a4ee` → `1937057`
**State:** deployed to production and verified live. Working tree clean, `check:deploy-ready` passes.

---

## 1. Why this work happened

Google Ad Grants rejected `stellreducation.org` for account **671-715-4074** after the
rebrand from insimeducation.com. Three stated objections:

1. The site "fails to demonstrate how your limited commercial activities align with
   the organization's mission"
2. It fails to "detail how the generated funds will be used"
3. "The images provided are of low quality"

All three were real and reproducible. **The resubmission to Google has not been sent** —
see §4.

---

## 2. What shipped

### Fund-use disclosure — `components/ui/MissionFundingNote.tsx`

One component, three variants (`general` / `store` / `donate`), rendered on **nine**
surfaces: `/donate`, `/membership`, `/store`, `/store/[slug]`, `/store/cart`, `/academy`,
`/events/[slug]`, `/register/[slug]/individual`, `/register/[slug]/group`.

David's first instruction was to place it on the donation page only. That would **not**
have answered the objection, which is about participation fees and merchandise, not
donations — the wider placement was agreed after pushing back. Worth remembering if the
scope is ever questioned.

### Financial transparency — `/impact#funding`

Four cards (how we are funded / what the fees pay for / where surplus goes / what we do
not do) plus a scholarship callout. Linked from the footer's About column, and from every
MissionFundingNote.

**EIN 86-2292698 is published in full**, and lives in `lib/org.ts` so it is typed once.
David initially asked for it masked to the last three digits and reversed that once it
was pointed out that a reviewer's purpose is verifying it against IRS records.

### Imagery

- **The homepage hero had been 404ing in production.** `app/(public)/page.tsx` requested
  `/images/hero-stem.jpg`; the file on disk was `hero-stem.JPG`. Vercel's filesystem is
  case-sensitive, so the hero rendered as flat navy. It is now a manifest photo
  (`home-hero-floor`, from DSC_5282) on the standard responsive pipeline; the orphaned
  4 MB original is deleted.
- **Burned-in watermarks removed** from all marketing photography, team headshots, video
  posters and PDF covers. See `[[watermark-removal-and-image-pipeline]]` in memory and §5.
- **Default social card** added (`public/images/og-default.jpg`, 1200×630). Every page had
  declared `twitter:card=summary_large_image` with no image, so all previews were blank.
- **Photography added** to `/why-stellr` (3 photos) and `/membership` (2), from a
  David-approved Drive folder. All new alt text says "participants".

### Copy softening (later in the session)

Three unconditional promises were removed at David's request:

| Where | Was | Now |
|---|---|---|
| `MissionFundingNote` general | "apply for a scholarship **and we cover the full cost**" | ends at the link |
| `/impact#funding` callout | "Cost is never the barrier… **we cover it in full**" | "We never want cost to be a barrier… we will do our best to cover it — either partially or in full" |
| `/impact` surplus card | "…still competes, **at no cost to their family**" | "…covering some or all of the participation fee" |

Verified on production: zero occurrences of any of the three phrasings remain.

---

## 3. New tooling

**`scripts/derive-photos.ts`** — derives 480/768/1200/1920 in AVIF + JPEG at the repo's
existing quality (jpeg 82 mozjpeg, avif 50), refuses to upscale, and prints the narrower
`widths` list to record on the manifest entry. Use this for every new photo. The
hand-rolled resizing it replaces is how the hero came to bypass the pipeline.

```
npx tsx scripts/derive-photos.ts <source> <output-id> [more pairs...]
```

**Watermark guard narrowed.** `scripts/lib/watermark-fs.ts` `SCAN` now covers
`public/student-work` only (15 assets). A new photo, PDF or video **no longer needs
watermarking** to pass `npm run build`. This supersedes the older guidance.

---

## 4. Open items

### High

- **The resubmission to Ad Grants support has not been sent.** This is the entire point of
  the work; the site is compliant and Google has not been told. A draft reply is in the
  session dossier. Send it from David's own account.
- **`/about` has zero photography.** Finding 3d named `/about`, `/why-stellr` and
  `/membership` as the three mission pages with no imagery. Two were fixed. `/about` was
  given one photo, which David then removed as unnecessary — so that page is back where it
  started, and the imagery objection is only two-thirds addressed. **Four already-clean
  assets sit unused in the manifest** and would fix it without new photography:
  `about-team-1`, `about-team-2`, `about-award-1`, `about-award-2`. Needs a decision.
- **Terminology is split.** David asked that "students are referred to as 'participants'".
  That was applied to photo alt text and captions, but body copy still says "students" in
  four places written this session: the funding note ("scholarships that let students take
  part") and three in `/impact#funding` ("before a single student walks in", "helping
  students whose school cannot fund a place", "stands between a student and a Stellr
  competition"). The question was raised once and never answered. Both wordings are live on
  the same screen on `/membership`.

### Medium

- **The two `/register/*` placements have never been rendered.** They sit behind an event
  and an auth flow and were verified only by reading the source and curling for the string.
  They are the least-verified of the nine surfaces.
- **Mobile verification is partial.** `/impact#funding`, `/why-stellr`, `/students` and
  `/store/cart` are confirmed at 375px. Not checked at mobile: the homepage hero,
  `/membership` proof strip, `/donate`, `/academy`, `/store`, `/store/[slug]`,
  `/events/[slug]`, and both `/register/*` pages.
- **11 manifest photo assets are declared but rendered nowhere** — `about-team-1/2`,
  `about-award-1/2`, `why-1`…`why-4`, `membership-hero`, `home-hero`, `home-strip-1`. Dead
  weight in the repo, and four of them are the fix for `/about` above.
- **PageSpeed was never measured** after the hero change. The claim that the old 4 MB CSS
  background would hurt LCP was reasoning, not measurement, and the replacement has not
  been measured either.
- **`og:image` was never run through a real social validator** — only confirmed that the
  tag is present and the asset returns 200.

### By decision, not open

- `testimonial-david-shaw.mp4` + its poster, and `janet-ivey-duensing.jpeg`, keep their
  burned-in watermarks. Neither has a clean predecessor anywhere in git history, and David
  chose to leave them. Everything else is clean.

---

## 5. Traps worth not relearning

- **Never bulk `git checkout` `public/` to undo the watermark pass.** Commit `e800089`
  bundled the watermark run together with genuine content updates. A per-file comparison
  (top 80% of the image, 64×64 greyscale, mean-abs-diff > 6 means a different photo) caught
  two files a bulk revert would have silently reverted: **Bill Allen's headshot**
  (770×731 → 800×800, a real swap) and **testimonial-david-shaw.mp4** (re-cut 110.6s →
  93.1s). For video, compare `ffprobe` width/height/duration.
- **Clean originals live in pre-`e800089` commits** — `c8049f5` (325 images), `1b7af60`
  (Bill Allen), `6042e11` (curriculum-group-work), `b14b9bf` (clean mp4s).
- **A `\uXXXX` escape does not work in JSX text**, only in a string literal. The em dash in
  the `/impact` callout is JSX text and needed the literal character; the one in
  `FUNDING_BLOCKS` is a string literal and the escape was fine. Check the rendered output,
  do not assume.
- **`next dev` serves stale ISR renders.** `/impact` has `revalidate = 3600`; after editing
  it the dev server kept serving the old copy and it read as a failed edit. `rm -rf
  .next/cache` and restart.
- **The browser pane's `window.innerWidth` is unreliable** — it reported 583 while the page
  was genuinely laid out at 375. Assert on `document.documentElement.clientWidth` and on a
  `matchMedia` result instead.
- **This repo's working tree is shared with concurrent sessions.** Commit `3b22cad`
  (campaign page parity — `CampaignDetail.tsx`, `lib/campaign-content.ts`,
  `app/api/register/individual/route.ts`) appeared in this session's branch base and was
  deployed alongside this work without being reviewed here; it is covered by
  `HANDOVER-campaign-parity-2026-08-25.md`. Every commit in this session was audited and
  contains only files authored here — but `git add -A` was used throughout, which is how
  that goes wrong. **Prefer committing by explicit path.**
- **Pushing a branch and then merging queues two Vercel builds**, and production waits
  behind the branch preview. Push straight to `main` when the branch is not needed for
  review.

---

## 6. Verification actually performed

Against production, after deploy, not just against the dev server:

- All new media assets and `og-default.jpg` return 200; `hero-stem.JPG` returns 404 and is
  referenced nowhere.
- EIN and a funding block present on `/donate`, `/store`, `/store/cart`, `/membership`,
  `/academy`, `/impact` and an event page.
- `/impact#funding` renders with all four cards; footer carries the link and the EIN.
- A marketing photo pulled back from the CDN has **no** corner watermark; a
  `student-work` asset pulled the same way **does**.
- None of the three removed promise phrasings appear anywhere.
- `/impact#funding` and `/why-stellr` confirmed at a true 375px layout.
