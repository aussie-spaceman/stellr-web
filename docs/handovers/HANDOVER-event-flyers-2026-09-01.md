# Handover — Event & campaign flyers (1 Sep 2026)

**Status: SHIPPED + LIVE + PROD-VERIFIED.** `fae5b0c` on `main`, deployed to
`www.stellreducation.org`. Seven 2027 flyers are attached in the production
Sanity dataset and render on their event/campaign pages.

Built in the worktree `~/Documents/GitHub/stellr-web-flyers` (branch
`feat/event-flyers-2026-09-01`) because a parallel session held the primary
checkout throughout.

---

## What shipped

| Piece | Where |
|---|---|
| `flyers[]` field (`label`, `file`, `pages?`) | `sanity/schemas/event.ts` |
| `EventFlyer` type, GROQ projection, `flyerDownloadUrl()` | `lib/sanity.ts` |
| Downloads panel (client component) | `components/sections/EventFlyers.tsx` |
| Render site — live events, aside between Event Details and the CTA | `app/(public)/events/[slug]/page.tsx` |
| Render site — campaigns, aside under the register card | `components/campaigns/CampaignDetail.tsx` |
| Upload/attach script | `scripts/upload-event-flyers.ts` (`npm run upload:event-flyers`) |
| Unit tests for the download-filename rule | `lib/sanity.test.ts` |

Live on: Nevada / Colorado / Nebraska / South Dakota SDC, Colorado / Minnesota
EDC, and `space-design-campaign-fall`. Texas, North Carolina, Rhode Island,
Uruguay and `environmental-design-campaign-fall` correctly render nothing.

## Why Sanity and not `/public`

The bytes hang off the document `_id`, so a slug rename can't strand them (the
Aug 2026 failure mode that orphaned 30 rows). A re-issued flyer is an upload,
not a commit + deploy. ~40MB/season stays out of a `.git` already at 1.0GB.
Studio uploads go straight to Sanity's asset API, so Vercel's 4.5MB
request-body cap never applies.

Supabase was rejected deliberately: `community_resources` / `container_contents`
is the *gated member* stack (auth, RLS, signed URLs, four space resolvers).
Flyers are top-of-funnel collateral that should stay crawlable and forwardable.

---

## OPEN ITEMS — read before continuing

### 1. `flyer_download` fires into nothing (P1)
`EventFlyers.tsx` pushes a `flyer_download` dataLayer event on click. **There is
no tag or trigger for it in GTM-WXBRWSH** — audited 1 Sep by curl'ing the
published `gtm.js`: the string appears **0 times**, where `competition_page_view`,
`lead_submitted` and `registration_submitted` all appear. Every flyer download is
currently untracked. Fix in the GTM UI: Custom Event trigger on `flyer_download`
→ GA4 event tag, params `competition_id`, `participation_type`, `flyer_label`.
Note the container caches ~15 min after publish.

### 2. The Studio authoring UI was never opened (P1)
The schema compiles, the data reads back and the site renders — but **nobody has
opened `/studio` and used the new "Flyers & Handouts" field**. The upload path
that David will actually use is unexercised. This repo has a repeated history of
admin surfaces reported done but never browser-verified. Add one flyer through
the Studio before trusting the field.

### 3. The script's replace-by-label branch has never run (P2)
`upload-event-flyers.ts` is documented as idempotent by label — a re-run swaps
the matching flyer and leaves Studio-authored entries alone. All seven documents
had an empty `flyers[]`, so **only the append path has executed**. The replace
path is untested; verify it on one event before relying on it for a re-issue.

### 4. Campaign page at mobile width, post-rewrite (P2)
The campaign Downloads panel was measured at 375px *before* the parallel
session's campaign-parity rewrite of `CampaignDetail.tsx`, and only at 1280px
after the rebase. Re-check 375px on `/events/space-design-campaign-fall`.

### 5. Five events/campaigns still have no flyer (P2 — content)
Texas, North Carolina, Rhode Island, Uruguay, and the Environmental campaign. No
deploy needed: upload in `/studio`, or add a row to the `FLYERS` map in the
script. Pages revalidate hourly (`revalidate = 3600`).

### 6. Variants in Drive are unattached (P3)
`1 Competitions/2027 Flyers/` also holds 1pp versions of all six, plus
`2027 - SDC - NV - Homeschool.pdf`, `2027 - SDC - NV - Robotics.pdf` and the SD
equivalents. `1 Campaigns/Flyers/` holds a 1pp Space Design flyer and
`2027 - Membership Tiers.pdf`. The field takes several per event — this is what
the array shape was for.

### 7. Housekeeping (P3)
- Worktree `~/Documents/GitHub/stellr-web-flyers` is still present with a
  **1.4GB copied `node_modules`**. Remove with `git worktree remove` when done.
- `origin/feat/event-flyers-2026-09-01` still exists; `main` fast-forwarded to
  it, so it can be deleted.
- Replacing a flyer leaves the previous Sanity asset orphaned. No cleanup exists
  (same gap as the upload architecture work).
- The Downloads links open in a new tab with no "opens in new tab" cue for
  screen readers.

---

## Traps worth keeping

- **`cdn.sanity.io` copies `?dl=` verbatim into `Content-Disposition`.** An
  `encodeURIComponent`'d filename is therefore *saved* percent-encoded
  (`2027%20-%20SDC%20-%20NV…pdf`). `flyerDownloadUrl()` emits a name that needs
  no encoding at all. Verified against the live CDN; covered by tests.
- **A cross-origin `download` attribute is ignored by browsers.** `?dl=` is the
  only thing that makes the file save rather than open inline.
- **Publishing while another session holds `main`:** `git checkout main` fails
  outright ("already used by worktree"). `git push origin <branch>:main` after a
  rebase publishes without ever checking main out locally, leaving their working
  tree untouched. Their local `main` is then behind — tell them to pull.
- **`gh` is not installed on this Mac.** There is no CLI path to open a PR.
- **Vercel took ~7 minutes** to serve this build, not the ~4 recorded earlier.
- **The watermark guard no longer covers PDFs** — its scope was narrowed to
  `public/student-work` images on 1 Sep. Sanity-hosted files never passed
  through it anyway.
