# Team profiles + balanced companies — 2026-10-08

Slug: `team-profiles`. Handover: `HANDOVER-team-profiles-2026-10-07.md` (close-out section 8 Oct). Doc snapshot: `1yby6lnbmhx6JjGGsfu9s2tgNCrHHh3MnhSCjcSrcfTo`.
PR #329 → `dev` as `b6c7e46`; promoted in #333 (`e7f1bf5`, `dpl_7E8NyASkZKNTJHco2yVizrXy35s8`). Migration: `20261007213644_team_profiles` (dev and prod, 8 Oct).

What shipped:
- Every student gets a 10-question team profile once their permission form is complete. It goes out from the e-sign completion path, from paperwork already on file, and from a daily cron at 09:45 UTC.
- Returning students get last time's answers pre-filled.
- Auto-Assign balances companies from the profiles.
- Staff get a "Team profiles" panel on the roster tab, an Email Reminders audience and template, and students see "My Team Profiles" on `/account`.

This session also ran three promotions:
- #326 (`6d71632`): educator PD + DocuSign opt-out read-back. Applied the `20261007203818` prod migration.
- #333: team profiles.
- #335 (`8892455`): event check-in v2 from another session. Applied the `20261007210357` prod migration.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| team-profiles.1 | First prod `team-profiles` cron run | Not run yet; first is 09:45 UTC 9 Oct. Prod aggregate read 8 Oct: Colorado (past, closed), Nevada 2 students and 0 signed, so the expected result is `sent: 0` | Read `cron_runs` for job `team-profiles` after 09:45Z on 9 Oct: `ok` and `sent: 0`, no errors | ☐ |
| team-profiles.2 | A real team-profile email in an inbox | Never sent anywhere. The local env has no `DEV_MAIL_SAFELIST` or token secret | When the first Nevada family signs, check that the email arrives (from David, link opens the form). Or Resend one dev student to the safelist from the dev site | ☐ |
| team-profiles.3 | Signed-in Team profiles panel (roster tab) and `/account` "My Team Profiles" | Seen only in Storybook. The pages were never loaded signed in on dev or prod | Open the Nevada roster tab on prod as admin: the panel lists 2 students as "Waiting on forms"; load a student's `/account` | ☐ |
| team-profiles.4 | A real Auto-Assign run with team profiles | Unit-tested only (25 tests incl. 100 students / 10 companies). Never run against real data | Before Nevada (6 Nov), once profiles are in: set companies, run Auto-Assign, check groups stay together and the pool lists non-responders with suggestions | ☐ |
| team-profiles.5 | Form + email copy sign-off | A draft. The 10 questions were approved with David's edits; the wording of the intro, emails and Email Reminders template is not signed off | David reads `components/team-profile/TeamProfileForm.tsx`, the `teamProfileEmailBody` in `lib/team-profile/store.ts` and the `team_profile_outstanding` template; changes before the first Nevada signature | ☐ |
| team-profiles.6 | "Previous participant" invitation (ask 9) | Only students with a previously **submitted** team profile get the pre-filled "check and update" email. A student with earlier Stellr registrations but no profile (anyone before 8 Oct) gets the standard email. David defined previous participant as "previous Stellr registrations" | Decide: is this acceptable? It self-corrects after one event. If not, add a "welcome back" line keyed on prior confirmed registrations | ☐ |
| team-profiles.7 | Email goes to the student only | Sent to the student's own email; to the guardian only when the student has none or shares it. No copy to parents, under-13s included | Confirm with David that parents need no copy (COPPA-wise, the consent form is the gate he chose) | ☐ |
| team-profiles.8 | Resend location | The per-student Send/Resend and the bulk send are in the Team profiles panel on the roster tab, not in each roster table row | Confirm that's fine; if not, add a button to the `EventRoster` row | ☐ |
| team-profiles.9 | Local testing needs a token secret | `.env.local` lacks `SURVEY_TOKEN_SECRET` and `ESIGN_TOKEN_SECRET`; links can't be minted locally | Add a dev-only `SURVEY_TOKEN_SECRET` to `.env.local` (never the prod value), or keep passing a throwaway one inline | ☐ |
| team-profiles.10 | Flaky e2e on #335 | `registration-docusign.spec.ts:99` "Ada can load her account" failed once on 401s from client fetches (session dropped); `survey.spec.ts:231` cert gate also flaked. Both passed on retry | If either recurs, fix the test session timing in `e2e/`. Not a product defect | ☐ |
| team-profiles.11 | Prod migrations applied this session | `20261007203818` (form_opt_outs), `20261007213644` (team_profiles), `20261007210357` (resources_url). Each was read back and ledger-realigned from the MCP timestamp. `db:status --prod` was clean except the known `20260910140426/27` | — | ☑ |
| team-profiles.12 | Promotions #326, #333, #335 | All merged with merge commits. Each production deployment was READY (by SHA) and aliased; the live checks passed; no runtime errors; record and sync PRs #330, #334, #336 merged | — | ☑ |

## Closes

- `educator-pd.3` (Promote #320): promoted in #326, merge `6d71632`, deployment `dpl_8EKudxtjb3rao3aBW16V2aogu4H2` READY and aliased (get_deployment, 8 Oct 15:17Z). www 200, app 307, cron guard 401, no runtime errors. Record: `.claude/releases/promote-2026-10-08.md`.
