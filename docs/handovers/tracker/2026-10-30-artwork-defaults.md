# Default artwork per theme, with per-event overrides — 2026-10-30

Slug: `artwork-defaults`. Handover: `HANDOVER-artwork-defaults-2026-10-30.md`. Doc snapshot: `1hTA1jp6OtPO60rhyTMsvcxMBGruENH4wuL7UDbRltBw`.
PR #491 → `dev` as `9d7fbff1`; **not yet promoted**: promotion PR #492 is open and green but held, and will be promoted in a separate session. Migration: `20261030202604_artwork_defaults`, applied to dev and production 30 Oct, with both ledgers realigned.

Every certificate, badge (Everyone/Mentors per Avery format) and educator PD page falls back to its theme's default unless the event uploads its own. Admins set the defaults on `/admin/competitions/artwork`; the Space defaults are seeded from the Colorado Space Design Challenge.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| artwork-defaults.1 | Promote #492 (#491 + #490 + #486 + docs) | Open, CI green on head `41210af7`, `CLEAN`. Held by David at the merge ("Not yet"), 30 Oct. Both migrations it needs are already on production. #494 (another session) may land on `dev` first and ride along | The promoting session: re-read `origin/main..origin/dev`, read CI again if the head moved, get a yes, `gh pr merge 492 --merge`. **Do not apply the migrations again**: `db:status -- --prod` lists only `20260910140426/27` | ☐ |
| artwork-defaults.2 | Production migration and seed | ☑ 30 Oct: applied via MCP and realigned to `20261030202604`. Read back: 6 Space certificates (mentor at name_y 0.51), `avery_8395/everyone` at Colorado's position, `avery_5392/everyone` unpositioned | — | ☑ |
| artwork-defaults.3 | **HIGH before Nevada (6 Nov):** Nevada prints from the defaults on production | Proven on dev only. Nevada has no artwork of its own on production | After `.1`: on production, Nevada Settings shows "Uses the Space default". Download the Avery 5392 (or 8395) badge PDF and the participation certificate preview, and check that names sit on the line before printing | ☐ |
| artwork-defaults.4 | Member credential PDF falls back to a default | Code path shared with the previews (exercised); the member route itself has not been hit with an event that has no art of its own | On the first credential issued at an event with no art of its own (Nevada), the owner's PDF prints on the Space default artwork | ☐ |
| artwork-defaults.5 | Colorado's own mentor certificate prints the name through the line | Colorado's `event_certificate_templates` mentor row is at name_y 0.545 (never positioned); 4 mentor credentials issued. Only the new default was moved to 0.51 | David decides. If yes, open Colorado Settings → Certificate of Appreciation → Position the name, and save near 51% (the same as the default) | ☐ |
| artwork-defaults.6 | Environmental defaults | None, by decision: Colorado EDC, Minnesota EDC and Uruguay EDC print the plain design | David uploads the Environmental set on `/admin/competitions/artwork?theme=environmental` when the art exists | ☐ |
| artwork-defaults.7 | Certificate pin's insert path against a real database | Unit test only. On dev, the only event with issued awards has its own rows, so the replace skipped it (proven) | The first time a Space default certificate is replaced after an event has issued that award on the default: that event gains an `event_certificate_templates` row with the old `artwork_path` | ☐ |
| artwork-defaults.8 | Positioner previews in a real browser, and a physical 5392 print | Headless Chromium can't render the PDF iframes. No sheet printed | Open "Position the name" on the defaults page in a real browser. Print one 5392 sheet at 100% | ☐ |
| artwork-defaults.9 | Dev state left by verification | ☑ 30 Oct, recorded so it is not mistaken for a bug: the dev Space defaults are the real Colorado files; the dev 5392 default was inserted by SQL; Nevada has a pinned PD front and layout; one unreferenced Nevada participation upload is in storage | — | ☑ |
| artwork-defaults.10 | No e2e for the defaults page or the "Use the default" round trip | Unit and route tests only | Add an admin e2e spec: the defaults page renders, and an event's Settings shows "Uses the Space default". It must pass with `NEXT_PUBLIC_SANITY_PROJECT_ID` unset (CI) | ☐ |

## Closes

- `scholarship-cancel.1` (production migration before the code): applied to production 30 Oct, during promotion #492, on David's direct instruction. The ledger was realigned to `20261030201934`, and `db:status -- --prod` no longer lists it.
- `scholarship-cancel.2`, **data half only**: production read after the apply shows 1 application `cancelled` (source `withdrawal`, `cancelled_at` set) and 1 still `offered`. The cancelled one was the only offer on a withdrawn registration beforehand. The admin-page half waits on `.1` and stays with that row.
