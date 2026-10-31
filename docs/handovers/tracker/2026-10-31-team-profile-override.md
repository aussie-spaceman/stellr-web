# Team profile override for Auto-Assign — 2026-10-31

Slug: `team-profile-override`. Handover: `HANDOVER-team-profile-override-2026-10-31.md`. Doc snapshot: `1_p7WNUFWUQosIL4YdwgSihIOnkjwALTw1cMm4b-Tb4c`.
PR #494 → `dev` as `6e014a47`; promoted in #492 (`1acd2721`, `dpl_GeYNKcYMN3Mkgdqi63ZSg4mQnGtp`), record #496. Migration: `20261030212236_team_profile_override` (dev 30 Oct, production 31 Oct, both ledgers realigned).

In Roster → Team profiles, staff can override the team-profile requirement for one student or for everyone not submitted. Auto-Assign then places overridden students alongside those who submitted, and the panel shows an "Overridden" pill with the underlying status and who overrode it.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| team-profile-override.1 | **HIGH before Nevada (6 Nov):** override and Auto-Assign signed in on production | Never clicked signed in, on dev or production. The panel was seen in Storybook and the component test; the route was unit-tested; the lib code was run against dev data. Production, 31 Oct: Nevada has 9 students, 2 profiles submitted, 0 overridden, 1 company | As an admin on production, open Nevada → Roster → Team profiles. Click "Override all not submitted", and check the pills read "Overridden" with "by <name> · <date>" beneath. Set companies, run Auto-Assign, and check the message reads "Placed N students (2 with team profiles, … overridden)" | ☐ |
| team-profile-override.2 | Copy sign-off | David chose the behaviour (four decisions, 30 Oct). The wording is mine: the pill sub-lines, the "Override all not submitted" confirm, the undo message and the Auto-Assign result message | David reads them in `components/admin/EventTeamProfiles.tsx` and `components/admin/EventCompanies.tsx`, or on screen during `.1`, and says what to change | ☐ |
| team-profile-override.3 | No e2e for override | Unit, route and component tests only | Add an admin e2e spec that overrides a seed student on the roster tab and sees the "Overridden" pill. Undo it at the end: the suite shares dev seed rows. It must pass in CI | ☐ |
| team-profile-override.4 | Migrations on dev and production | ☑ Dev 30 Oct; production 31 Oct on David's yes. MCP recorded `20261031194241` on production; realigned to `20261030212236`. Columns and comment read back; `db:status --prod` no longer lists it | — | ☑ |
| team-profile-override.5 | Promotion #492 | ☑ 31 Oct: merged with a merge commit (`1acd2721`); deployment READY and aliased; www 200, app 307, cron guard 401, Node 24.x in the build log, no runtime errors after the deploy. Record and `dev` sync #496 merged (`64ab13e1`) | — | ☑ |
| team-profile-override.6 | Dev data used for verification | ☑ 30 Oct: Nevada's three dev test students were overridden and auto-assigned, then restored. 0 companies, 0 rows changed, read back in SQL | — | ☑ |

## Closes

- `artwork-defaults.1` (Promote #492): merged 31 Oct as `1acd2721` after David's yes, with #494 riding along. Before the merge, CI was green on head `6e014a47` with every step read, `dev` and `main` were unchanged, and the migrations were not re-applied (`db:status --prod` showed both as applied). Deployment `dpl_GeYNKcYMN3Mkgdqi63ZSg4mQnGtp` is READY and aliased. Record: `.claude/releases/promote-2026-10-30c.md` (#496).
- `admin-dashboard-digest.4` (production on Node 26): #486 was promoted in #492. The production build log for `1acd2721` reads "Node.js version changed from "26.x" to "24.x"" and has no "engines … will be used instead" line. `get_runtime_errors` on the production project shows no error groups from 19:49 to 20:39 UTC on 31 Oct, so the `localStorage` warning group has not recurred.
