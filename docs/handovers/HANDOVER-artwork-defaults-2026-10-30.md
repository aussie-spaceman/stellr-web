# Handover — default artwork per theme, with per-event overrides (30 Oct 2026)

Tracker: `docs/handovers/tracker/2026-10-30-artwork-defaults.md` (rows `artwork-defaults.1–.10`). No member is involved, so there is nothing for the Doc beyond the table.

**Not promoted.** The code is on `dev` (#491, `9d7fbff1`). The promotion PR #492 is open and green but was **held** by David ("Not yet"). Promotion will happen in a separate session. **Both migrations it needs are already on production**, so that session must not apply them again. They are additive, so the live code is unaffected meanwhile.

## Why

David asked for two things:

- **Defaults.** Name badges, certificates, participation credentials and educator PD each need a default or template file for every option.
- **Overrides.** Each event can upload its own customised version.

The artwork the Colorado Space Design Challenge printed in October is the first set of defaults.

## Owner decisions (30 Oct, David)

I asked six questions, and David chose the recommended option on each:

1. **Per theme.** The Colorado artwork prints "2027 Space Design Competition", so it is the **Space** default. Environmental events (Colorado EDC, Minnesota EDC, Uruguay EDC) keep printing the plain design until Environmental defaults are uploaded.
2. **Past events keep their artwork.** Before a default certificate or PD page is replaced or removed, the outgoing one is copied to every event that has issued that credential on it.
3. **Admins only** change defaults. Event managers still upload their own event's art.
4. **Avery 5392 reuses the 8395 art.** Colorado printed only the 8395 sticker. The 5392 default is the same file, unpositioned, so the renderer finds the line in the 4×3 crop.
5. **Participation** uses the file Colorado printed (the 24 Sept upload), not the newer Drive export.
6. **Ship and promote.** Shipping is done. The promotion was held at the merge (see above).

## What shipped (#491 → `dev` `9d7fbff1`)

### Data

Migration `20261030202604_artwork_defaults`:

- `default_certificate_templates (theme, award_type)`, with the same placement columns as `event_certificate_templates`.
- `default_badge_templates (theme, format, audience ∈ everyone|mentors)`, with nullable placement as on `event_badge_templates`. There are no company defaults; companies belong to one event.
- Seed: Colorado's own rows, copied by `SELECT`. **The default rows point at Colorado's stored files** (`event-artwork/colorado-space-design-challenge/…`); no file was copied. Colorado keeps its own rows.
- The mentor default starts at `name_y 0.51`. Colorado's own mentor template was never positioned, and at 0.545 the name runs through that artwork's line. Colorado's row is unchanged (`.5`).
- PD needs no table. The theme default stays at `pd-certificate/<theme>/{front,back,layout.json}`. An event's own pages go to `pd-certificate/events/<slug>/…`, page by page; the layout goes with the front.

### Resolution

`lib/artwork-defaults.ts`, `lib/artwork-theme.ts`:

- **Certificate:** the event's row, then the theme default, then the plain design for member downloads. The admin print still asks for artwork.
  - `loadTemplates(db, slug, theme)`
  - `effectiveTemplates`
- **Badges:** `effectiveBadgeTemplates(own, defaults)` fills each everyone/mentors slot the event lacks. `pickTemplate` then runs unchanged (mentors → company → everyone → plain).
- **PD:** `loadPdArtwork(db, theme, event)` and `loadPdLayout(db, theme, event)`, page by page.
- **Theme:** the Sanity event `type`, else the slug (`artworkTheme`). The credential route uses `credentials.theme`.

### Pinning

`pinDefaultCertificate` and `pinDefaultPdPage` run before a default's artwork changes or a default is removed. Each finds the events with issued credentials of that theme (and award), using `eventsIssuedOn`, which pages past PostgREST's 1000-row cap. It then gives each event without its own copy one.

If pinning fails, the default is not replaced. Badges are not pinned: they are printed before an event and never downloaded later.

### Routes and UI

- **Event routes, extended:**
  - `GET /api/admin/events/[slug]/certificate-templates` returns `{ theme, templates (own), defaults }`.
  - The same route gains `DELETE ?awardType=`, which goes back to the default.
  - The badge GET returns `defaults`.
  - The print, preview and member PDF routes resolve defaults.
- **New default routes,** admins only: `/api/admin/artwork-defaults/[theme]/{certificate,badge}-templates` (GET/PUT/DELETE), each with `/preview`.
- **PD route:** `/api/admin/pd-certificate` takes `event` (GET/PUT/DELETE).
- **Uploads:** new upload purpose `artwork-default`, admin only, at path `artwork-defaults/<theme>/<kind>-…`.
- **Shared input parsing:** `lib/artwork-template-input.ts`. The event-artwork claim now also passes `expectedPrefix`.
- **New page:** `/admin/competitions/artwork`, Competitions → Default artwork (admins only). It has Space and Environmental tabs and reuses `EventBadges`, `EventCertificates` and `PdCertificateArtwork`, which now take an optional `eventSlug`. Without it, they edit the theme default.
- **Event Settings rows** read "Uses the Space default", "This event's own artwork", or "No artwork yet". They offer "Upload this event's own" and "Use the default". When a theme has no defaults at all, the header says so.

## Production state (30 Oct, after this session)

- **Applied:** `20261030202604_artwork_defaults` (ledger realigned).
- **Read back:**
  - 6 Space certificates (participation, champions, Norm Chaffee, Anita Gale, Dick Edwards, mentor at 0.51).
  - `avery_8395/everyone` at Colorado's position.
  - `avery_5392/everyone` with no position.
- **Also applied, for the promotion:** #490's `20261030201934_scholarship_cancellation`. Auto mode refused the first attempt; it went through on David's direct "Apply it now". It is recorded under Closes in the tracker.
- **Still pending:** `npm run db:status -- --prod` lists only the known historical pair `20260910140426/27`.

## Verified (dev, local server, signed-in admin via Playwright)

- **Defaults page:** uploaded the 8395 badge, Champions, Norm Chaffee and mentor art as Space defaults. All returned 200, and the badge line was found.
- **Production's 5392 seed:** reproduced on dev with SQL. Nevada's 5392 sheet prints the names on the line.
- **Nevada (Space, no art of its own):** every row reads "Uses the Space default". The badge PDFs (5392, 8395), the certificate previews and the PD preview all returned 200 on the default art.
- **PD pinning, end to end:** Nevada has a PD credential on dev. Replacing the Space front first copied the old front and its layout to `pd-certificate/events/nevada-space-design-challenge/`.
- **Override round trip:** uploaded Nevada's own participation art, then "Use the default". The row was deleted.
- **Colorado Environmental:** "No artwork yet". The header says there are no Environmental defaults.
- **Checks:** lint (0 errors), `lint:tokens`, `lint:migrations`, `tsc`, and the full vitest run (2,613). #491 CI: every step succeeded. #492 CI on `41210af7`: every step succeeded.

## Not verified

- A member's credential PDF falling back to a default (`.4`).
- The positioner previews in a real browser. Headless Chromium cannot render PDF iframes (`.8`).
- A physical 5392 print (`.8`).
- The certificate pin's insert path against a real database. It is covered by a unit test only (`.7`).
- The panels as an event manager. The e2e `event_manager` fixture is not provisioned.

## Things to know

- **The defaults share Colorado's storage objects.** Nothing deletes event artwork today. Any future storage cleanup that removes "unreferenced" files must also check `default_certificate_templates` and `default_badge_templates`, or the defaults break.
- **Pinning matches on `credentials.theme`.** Every production event credential has it set (30 Oct). A credential with a null theme would not be pinned.
- **Dev state left by verification** (`.9`):
  - The dev Space defaults are the real Colorado files, uploaded 30 Oct under `artwork-defaults/space/`.
  - The dev 5392 default was inserted by SQL.
  - Nevada on dev has a pinned PD front and layout (the old dev front).
  - An unreferenced Nevada participation upload remains in dev storage.
