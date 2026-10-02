# Handover: spare name badges (29 Sept 2026)

**Shipped:** PR #259 → `dev` `d8122d6`, promoted in #260 (`ad3828c`, 30 Sept MDT). Record and sync #261 (`.claude/releases/promote-2026-09-29c.md`).
**Tracker:** `tracker/2026-09-29-badge-spares.md`. Doc snapshot `1ejBrdtroqTNQD55GUs81WHFDtxACUAhZVxkB88XtzQE`.
**Context:** the badge system is described in `HANDOVER-avery-8395-badges-2026-09-25.md` (and its 28 Sept addendum). Read that first.

## What was asked
From the maintainer: "for both Avery supported formats, there always needs to be a full page of spare name tags printed."

## What changed
| Piece | Where |
|---|---|
| How many spares | `spareCount(roster, format)` in `lib/badge-layout.ts` returns `(perPage - roster % perPage) % perPage + perPage`: the rest of the last sheet plus one full sheet. That is 8 per sheet on 8395 and 6 on 5392. |
| Which design | `resolveBadges(db, holders, templates, { spares: format })` in `lib/event-badges.ts` appends blank badges using the template an unaffiliated non-mentor would get (Everyone), or `null` (plain). Template lookup is now one local `designFor`. |
| Drawing | `generateBadgesPdf` skips the name when it is blank. A plain spare draws only the event title. |
| Where | Only the download route (`badges?format=`). The preview is unchanged. |
| Tests | `lib/badge-layout.test.ts`: `spareCount` for every roster size 1–30 on both formats (at least one full page of spares, ending on a full sheet), and 0 text draws on 8 spares against 8 for the same sheet with names. |

## Not verified
- A signed-in download on prod (badge-spares.1). Verified so far: the deployment is READY on `ad3828c`, the download returns 401 without a session, and a local render on the real CO SDC background is correct.

## Open items
`badge-spares.1`–`.4` in the tracker file. The most urgent is the physical print check for the CO SDC event on 3 Oct (Session 18's 18.2, together with badge-spares.1).

## Gotcha
The scratchpad copy of the promotion record vanished between the promotion PR and Step 8. It was rebuilt from the PR body, which is why `promote` keeps the PR body as the durable record.
