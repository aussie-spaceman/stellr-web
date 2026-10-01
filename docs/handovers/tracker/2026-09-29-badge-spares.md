# Spare name badges — 2026-09-29

Slug: `badge-spares`. Handover: `HANDOVER-badge-spares-2026-09-29.md`. Doc snapshot: `1ejBrdtroqTNQD55GUs81WHFDtxACUAhZVxkB88XtzQE`.
PR #259 → `dev` as `d8122d6`; promoted in #260 (`ad3828c`, production `dpl_JDuRt1REJztjf1eYXmU1X2213MfZ`, READY); record + sync #261. Migration: none.

For both Avery formats, the badge download now appends blank spares after the roster: the rest of the last sheet plus one full sheet (`spareCount` in `lib/badge-layout.ts`). Spares use the **Everyone** background with no name, or a plain empty label if there is no Everyone background.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| badge-spares.1 | First signed-in download on prod | Prod is serving `ad3828c` (READY, matching SHA). Without a session the download returns 401. Nobody has downloaded the badge PDF signed in since the promotion. Unit tests and a local render on the real CO SDC background are the only evidence (9 names → 3 pages, the last a full sheet of 8 blanks). | Do this with 18.3: on prod, open CO SDC → Settings → Name badges → Avery 8395, download, and check that the last page is 8 blank badges on the Everyone background. **Before 3 Oct.** | ☐ |
| badge-spares.2 | Last-sheet fill was inferred | The maintainer asked for "a full page of spares". The session also fills the rest of the last roster sheet, which would otherwise print empty. This was flagged at the time but not confirmed. | Maintainer: confirm, or have `spareCount` return `perPage` only. | ☐ |
| badge-spares.3 | No spares for company or mentor backgrounds | Spares always use the Everyone background. An event that gives mentors or companies their own background gets no blank badges in those designs. Not asked for. | Maintainer decision: per-audience spares (e.g. one sheet per template) or not. If wanted, extend `resolveBadges(..., { spares })` to append a sheet per template. | ☐ |
| badge-spares.4 | 18.9 is now due | 18.9 said "after the next promotion" drop `event_settings.badge_artwork_path` / `badge_8395_artwork_path`. #260 was that promotion. `git grep` (29 Sept): no app code reads either column; only `supabase/baseline.sql` and migrations mention them. | A migration `ALTER TABLE public.event_settings DROP COLUMN IF EXISTS badge_artwork_path, DROP COLUMN IF EXISTS badge_8395_artwork_path;`, applied by David on dev, then on prod in `promote`. Not urgent; after 3 Oct is fine. | ☐ |

## Still open from Session 18 (not edited here; rows live in `../TRACKER.md`)

- **18.2 (HIGH, before 3 Oct):** the 8395 sheet geometry has never been checked on a physical sheet. The spares add one more page to test with.
- **18.3 / 18.4:** the prod CO SDC Everyone preview and the panel have never been viewed (badge-spares.1 closes alongside).
- 18.1 (dev migration record), 18.5 (long names), 18.6 (inferred choices), 18.11 (`migration:new` no-op), 18.12 (per-audience download).
