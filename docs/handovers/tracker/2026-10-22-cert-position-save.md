# Certificate "Save position" fix — 2026-10-22

Slug: `cert-position-save`. Handover: `HANDOVER-cert-position-save-2026-10-22.md`. Doc snapshot: `1iyTE1I3m-tsE4-td30fc33UaPmv6B2FHUEBUt3XrrLM`.
PR #453 → `dev` as `4a938b27`; promoted in #454 (`8a61c7fe`, 22 Oct); record + sync #456 (`f612e1d8`). Migration: none.

On the competition Settings tab, Certificates → Position the name → Save position now saves the name's position for every award. It used to return "Database error" (Postgres 23502 on `artwork_path`), because the route upserted a row without the artwork. Artwork upload was never broken.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| cert-position-save.1 | Save position on production, signed in | Fix live in `dpl_DWzaggcKRpvpVuBZDkPDi2u6Wwky`. Proven on dev through the real UI (`PUT 200`, `name_y` stored, artwork kept). Not run on production: no production admin session here. Every prod template still has the default placement | On the Colorado Settings tab: Norm Chaffee → Position the name → Save position, and see "Name position saved". Or read that row's `updated_at` on prod afterwards | ☐ |
| cert-position-save.2 | Norm Chaffee artwork wording vs the award label | Colorado's artwork (uploaded to prod 22 Oct) prints "Norm Chaffee Award for Engineering Excellence" and a longer citation. The app's label is "Norm Chaffee Finalist", with "For excellence at this event." (`lib/event-awards.ts`), and the credential page, issue email and LinkedIn share use it. That file says labels match the artwork word for word. No finalist has been issued yet | David picks one wording before the first finalist is issued: new artwork matching the label, or a label/description change in `lib/event-awards.ts`. A rename after issue needs `RELABELLED_AWARD_TYPES`. See `norm-chaffee-award.1` | ☐ |
| cert-position-save.3 | Fix landed on `dev` | #453 squash-merged as `4a938b27`. CI on `84a6ed03`, every step read: `changes`, `verify` and `e2e` succeeded. New `route.test.ts`: 4 pass, and 2 fail on the old route | — | ☑ |
| cert-position-save.4 | Promotion #454 in production | Merged `8a61c7fe` at 18:34 UTC. `dpl_DWzaggcKRpvpVuBZDkPDi2u6Wwky` READY, and `www`/`app`/apex resolve to it. `www` 200, `app` 307, cron 401, the certificate route 401 when signed out. No error logs in the first minutes. Record + sync #456 merged; `main` is an ancestor of `dev` | — | ☑ |

## Closes

- `vercel-active-cpu.1` (#451 and #452 in production; tracker on close-out #455): #454 was merged through `promote` as `8a61c7fe`. `list_deployments` by that SHA shows `dpl_DWzaggcKRpvpVuBZDkPDi2u6Wwky`, target production, READY, and `vercel inspect` shows `www`, `app` and the apex domain on it.
- `vercel-active-cpu.9` (app-host manifest): `GET https://app.stellreducation.org/manifest.webmanifest` after #454 returned name "My Stellr" and `start_url` `/home`. `www` returned "Stellr Education" with `start_url` `/`.
