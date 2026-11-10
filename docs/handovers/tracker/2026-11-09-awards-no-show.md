# Awards: no-shows off the panel, awards and students counted apart — 2026-11-09

Slug: `awards-no-show`. Handover: `HANDOVER-awards-no-show-2026-11-09.md`. Doc snapshot: `1NqzXqT_fj49hYS3oZJmcg5Lwww46KeIqmn_tCCDtEyw`.
PR #590 → `dev` as `4fa5c127`; not promoted (promotion is a separate session). Migration: none.

Judging & awards and printed certificates now use `attendees()` (`lib/event-certificates.ts`): checked-in students when the event used check-in, otherwise all. A student who registered but never checked in no longer shows as a "No company" row and cannot be awarded. "Issue awards" now reports "N awards to M students" instead of "N issued".

| # | Item | State | Next | Done |
|---|---|---|---|---|
| awards-no-show.1 | Promote #590 | On `dev` (`4fa5c127`), every CI step read and passing (unit, typecheck, build, both Playwright suites). Not in production. | Promote (planned for a separate session). | ☐ |
| awards-no-show.2 | Production panel shows no "No company" row for the Nevada event | Prod read-only SQL, 9 Nov: 11 students checked in and placed, 1 on a `pending` registration never checked in and unplaced; that one is the row. Fix covered by route tests only; not seen in a browser. | After .1: open the Nevada Judging & awards panel; the company table lists Company 1 and Company 2 only. | ☐ |
| awards-no-show.3 | Nevada awards already issued are correct | Prod read-only SQL, 9 Nov: 12 award credentials to 8 distinct students (6 champion, 2 Norm Chaffee, 2 Anita Gale, 2 Dick Edwards), none to a student who did not check in, none revoked. | None. | ☑ |
| awards-no-show.4 | `students` count in the Issue awards message | Added in `issueAwards`; no unit test (the function is database-bound). | At the next real "Issue awards", check the student count against `count(distinct participant_id)` of that run's new credentials. | ☐ |
| awards-no-show.5 | Pending registrations count as students when an event did not use check-in | `listEventStudents` excludes only `withdrawn`, so an unpaid `pending` registration is printed and awardable at an event with no check-in. Out of scope for #590. | Owner decides whether `pending` should be excluded too. | ☐ |
| awards-no-show.6 | One email per award | A student with two awards gets two emails (4 such students at Nevada). Unchanged by #590. | Owner decides whether to combine them; no action if not. | ☐ |
| awards-no-show.7 | Full unit suite in a `.claude/worktrees/` checkout | 8 Clerk/CSP tests (`test/tenant-csp.test.ts`, `test/csp-script-nonces.test.tsx`) fail there: they import `../node_modules/@clerk/...` by relative path, which a worktree without its own `node_modules` lacks. CI passes. | Resolve those imports through the package (`require.resolve`) or note it in the ship skill. | ☐ |
| awards-no-show.8 | Session worktree `.claude/worktrees/awards-no-show` | Kept: app-managed, `npm run worktrees` says to archive the session. | Archive this session in the Claude app. | ☐ |
