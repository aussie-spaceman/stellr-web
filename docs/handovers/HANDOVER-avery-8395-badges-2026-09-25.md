# Handover: Avery 8395 name badges (25 Sept 2026)

**Shipped:** PR #206 landed on `dev` as `e0f3a91`. A separate session promoted it (#208 → `868a178`; `.claude/releases/promote-2026-09-25b.md`).
**Migration:** `supabase/migrations/20260925140000_badge_8395_artwork.sql`. It adds one nullable column, `event_settings.badge_8395_artwork_path`.
- Prod: applied, and the ledger row is `20260925140000` (read 25 Sept).
- Dev: the column is present, but David applied it outside the ledger, so it has **no ledger row** (18.1).

**Tracker:** `TRACKER.md` Session 18. Doc snapshot `1Au-xSMrXRMJdOV3I3HAy51wTU31AYhnfrugyusaflws`.

## What was asked
From the maintainer, as user stories for an admin or event manager:
1. Toggle between Avery 5392 (the existing layout) and Avery 8395.
2. Upload a background image for either.
3. Click download and receive a PDF for printing.
4. All participant names (students, volunteer mentors) align automatically on the clear space above the background's horizontal line. The line is usually vertically centred, but not always.
5. First and last names, with the font shrunk so long names stay on one line.

There was no Q&A. Every other choice below is the session's inference (18.6).

## How it works (the map)
| Piece | Where |
|---|---|
| Formats (geometry, bleed, cut guides, max name size, upload kind, DB column) | `lib/badge-layout.ts` `BADGE_FORMATS` (pure; the client imports it) |
| Rule finder | `lib/badge-layout.ts` `findNameLine`. It looks for the longest run of pixels that step away from the colour above and step back within ≤5% of the height. The "step back" rejects colour-band edges. Of rules within 85% of the longest, it picks the one with the most clear space above. It returns fractions of the image, the clear-space height and the background luma. `null` if no run covers ≥25% of the width. |
| Name placement | `nameSetting`. The baseline sits 3pt plus the descender above the rule. The size is capped by the clear space and `maxNameSize` (5392: 30pt, 8395: 26pt). The width is the rule's span. With no rule, the name is centred on the label. `fittedSize` shrinks it to one line (6pt floor). |
| Artwork prep (sharp) | `lib/badge-artwork.ts` `prepareBadgeArtwork`. It centre-crops to label + bleed at 300 dpi, then runs the finder at 480 px wide. It is a **separate module on purpose**: sharp/libvips is traced only into the two badge routes, not into certificate or credential routes (Function Storage meter). |
| PDF | `lib/event-pdf.ts` `generateBadgesPdf(people, eventTitle, format, artwork)`. Names are in Aileron, white if the clear space's luma is < 110. There is no visible © stamp, but `markWatermarked` is set. |
| Download | `GET /api/admin/events/[slug]/badges?format=avery_5392\|avery_8395`. The badge list is registrations' participants plus active assigned volunteers (`cohort_members` relationship=`volunteer` on the event container), deduped by `member_id` and sorted by last name. |
| Upload | `POST /api/admin/events/[slug]/artwork` with `kind` = `badge` (5392) or `badge8395`. It replies `{ lineFound }`. The kinds are chosen so neither is a `${kind}-` prefix of the other. |
| UI | `components/admin/EventBadges.tsx` (toggle, per-format upload, message, download) |
| Page | `app/(admin)/admin/competitions/[slug]/page.tsx`. The settings tab now loads `event_settings` for event managers too. |
| Tests | `lib/badge-layout.test.ts`: 15 tests on synthetic SVG artwork (centred, off-centre, band edge, dark background, JPEG hairline, two rules, none), plus geometry and PDF page counts |

**8395 geometry** (inches, from the top-left): the first label is at (0.6875, 0.59375), pitch 3.75 × 2.5, label 3.375 × 2.3333, 2 × 4, 1/16″ bleed. These are gLabels' Avery 5395/8395 template values. **They have not been checked against a physical sheet (18.2).**

## Open items
See `TRACKER.md` Session 18: 18.1–18.7.

## Gotchas for the next session
- A new badge format is one entry in `BADGE_FORMATS`, plus a column, plus a migration. `EVENT_ARTWORK_KINDS` in `lib/uploads.ts` derives from it.
- The detection runs on **every download** (one sharp decode per format) and again on upload for the message. Nothing is persisted.
- The rule finder works on RGB max-channel differences with a threshold of 48. A faint rule (e.g. light grey on white, Δ < 48) is not found, and the names fall back to centred.
