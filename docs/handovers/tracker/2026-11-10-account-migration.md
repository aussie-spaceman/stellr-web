# Account migration and ownership move — 2026-11-10

Slug: `account-migration`. Handover: `HANDOVER-account-migration-2026-11-10.md`. Doc snapshot: the owner-only private handover in Stellr's Drive ("Handover 2026-11 (restricted)").
PR #… → `dev` as `<sha>`; promotion not needed (docs only). Migration: none.

On 10-Nov-2026 Claude-assisted work moved from a personal Claude account to Stellr's Team (non-profit) account, and the personal account closed. Account-only assets were exported to Stellr's private Drive first. Services on personal identities move to Stellr-owned accounts next. Priorities: no knowledge loss, protecting minors' data, security.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| account-migration.1 | Export account-only assets (22 artifacts, 6 routines, cloud memory store, account skills, claude.ai Docs) | Captured 10-Nov | Read back counts in the private folder | ☐ |
| account-migration.2 | claude.ai data export (chats, Projects) | Requested by the owner | Download, mine, store encrypted with a delete-by date | ☐ |
| account-migration.3 | Claude Design files and Project knowledge | Owner to download | Public-safe design files → `design/handoff/` after a personal-data read | ☐ |
| account-migration.4 | Claude Code memory curated for the Team account | Originals archived 10-Nov | Curate in place; update connector IDs | ☐ |
| account-migration.5 | Local-only git work archived (bundle + dirty-worktree patches) | Archive made 10-Nov | `git bundle verify`, then sweep merged/dead worktrees | ☐ |
| account-migration.6 | Team account set-up: seats include Code + Cowork, retention, org skills, plugins, connectors re-added with least privilege | Owner | Smoke-test each connector with one read-only call | ☐ |
| account-migration.7 | Recreate the weekly scorecard routine; re-approve the 8 local scheduled tasks (AEO monthly panel, `ad-grants-first-serve-check` on 13-Nov, `ad-grants-weekly-review`, `ad-grants-monthly-review`) with "Run now"; transcript-purge reminder for 08-Feb-2027 | After sign-in | One test run of each; the first-serve check must run on 13-Nov | ☐ |
| account-migration.8 | Republish living artifacts on the Team account; fix docs that link old artifact or session URLs | After sign-in | | ☐ |
| account-migration.9 | Gate passed, old account closed, third-party grants revoked at each provider | Owner | Record the date in the private handover | ☐ |
| account-migration.10 | Rotate credentials with proven exposure | Owner decision 10-Nov: rotate proven exposures only | Staged, one at a time, site verified after each; log is private | ☐ |
| account-migration.11 | Local hygiene: lock down or remove local credential files; remove stale e2e login files | After the git archive is verified | | ☐ |
| account-migration.12 | Personal-data exports on the development Mac: move to restricted Drive per the retention schedule, then delete local copies | Triage list made 10-Nov (private) | Owner moves and deletes | ☐ |
| account-migration.13 | Ownership audit of every service (owner, login, recovery, MFA, billing, plan) | Register started (private) | Fill the blanks | ☐ |
| account-migration.14 | GitHub: Stellr organisation, transfer the repo, make it private, CODEOWNERS to an org team, reconnect Vercel Git, check Actions minutes | Decided 10-Nov | Supersedes `public-repo-personal-data.4`–`.6` once done | ☐ |
| account-migration.15 | Redact older docs and PR bodies that predate the personal-data rule | After .14 | Supersedes `public-repo-personal-data.3` and `worktree-cleanup.4` | ☐ |
| account-migration.16 | Delete old CI `playwright-report` artifacts | Owner | Closes `playwright-report-exposure` artifact-deletion row | ☐ |
| account-migration.17 | Vercel → org-owned Pro team (`docs/RUNBOOK-vercel-pro.md`) | After .14 | Verify crons, env, domains | ☐ |
| account-migration.18 | Supabase and Clerk → org-owned organisations with work-email owners | After .17 | | ☐ |
| account-migration.19 | Remaining services; registrar and DNS last | After .18 | | ☐ |
| account-migration.20 | Second admin and break-glass on critical accounts; org password manager | Owner decision | | ☐ |
| account-migration.21 | Fill governance slots: incident-response deputy, counsel, insurer; leaver procedure; program owner | Owner decision | Update `docs/compliance/*` | ☐ |
| account-migration.22 | Continue the S5 multi-tenant build on the Team account from its transfer handover (wave 6: restore the bundle, Lane A reviews and fixes, ship A → C → D) | Session idle at the switch; bundle verified and archived | Read the private copy of the S5 handover first | ☐ |
| account-migration.23 | Continue the Ad Grants follow-ups on the Team account (`ad-grants-rebuild.1`–`.11`) | Session idle at the switch; close-out merged (#609) | First-serve check on 13-Nov | ☐ |
