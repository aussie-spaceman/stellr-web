# Account migration and ownership move — 2026-11-10

Slug: `account-migration`. Handover: `HANDOVER-account-migration-2026-11-10.md`. Doc snapshot: the owner-only private handover in Stellr's Drive ("Handover 2026-11 (restricted)").
PR #… → `dev` as `<sha>`; promotion not needed (docs only). Migration: none.

On 10-Nov-2026 Claude-assisted work moved from a personal Claude account to Stellr's Team (non-profit) account, and the personal account was downgraded to Free (owner decision: kept, not deleted). Account-only assets were exported to Stellr's private Drive first. Services on personal identities move to Stellr-owned accounts next. Priorities: no knowledge loss, protecting minors' data, security.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| account-migration.1 | Export account-only assets (22 artifacts, 6 routines, cloud memory store, account skills, claude.ai Docs) | Read back 11-Nov: 22 artifacts, 6 routines and 5 Docs present in the private staging folder |  | ☑ |
| account-migration.2 | claude.ai data export (chats, Projects) | Requested by the owner | Download, mine, store encrypted with a delete-by date | ☐ |
| account-migration.3 | Claude Design files and Project knowledge | Owner to download | Public-safe design files → `design/handoff/` after a personal-data read | ☐ |
| account-migration.4 | Claude Code memory curated for the Team account | Curated in place 10-Nov: minors' and families' names replaced by role, connector IDs updated |  | ☑ |
| account-migration.5 | Local-only git work archived (bundle + dirty-worktree patches) | Archive made 10-Nov | `git bundle verify`, then sweep merged/dead worktrees | ☐ |
| account-migration.6 | Team account set-up: seats include Code + Cowork, retention, org skills, plugins, connectors re-added with least privilege | Done 10-Nov: connectors re-added; each answered one read-only call. Certifier and Wix dropped (owner decision) |  | ☑ |
| account-migration.7 | Recreate the weekly scorecard routine; re-approve the 8 local scheduled tasks (AEO monthly panel, `ad-grants-first-serve-check` on 13-Nov, `ad-grants-weekly-review`, `ad-grants-monthly-review`) with "Run now"; transcript-purge reminder for 08-Feb-2027 | Done 10-Nov: scorecard routine recreated (HubSpot + Gmail), test run OK; the 4 live local tasks recreated on the Team account, 4 finished one-offs retired; purge reminder set for 08-Feb-2027 | First-serve check runs 13-Nov | ☑ |
| account-migration.8 | Republish living artifacts on the Team account; fix docs that link old artifact or session URLs | Done: 7 living artifacts republished; 6 docs relinked in #614; the DMARC handover's old-account session link replaced 11-Nov |  | ☑ |
| account-migration.9 | Gate passed, old account closed, third-party grants revoked at each provider | Gate passed 10-Nov. Old account downgraded to Free, not deleted (owner decision) | Owner revokes third-party grants | ☐ |
| account-migration.10 | Rotate credentials with proven exposure | Done 11-Nov: web-gate token rotated 10-Nov; the Stripe key flagged as exposed is no longer the live key (owner checked), so no roll needed |  | ☑ |
| account-migration.11 | Local hygiene: lock down or remove local credential files; remove stale e2e login files | Done 11-Nov: all `.env.local` files mode 600; `PROD_DATABASE_URL` now only in the `prod-migrations` environment secret, no local copies; 8 stale `e2e/.auth` folders removed |  | ☑ |
| account-migration.12 | Personal-data exports on the development Mac: move to restricted Drive per the retention schedule, then delete local copies | Triage list made 10-Nov (private) | Owner moves and deletes | ☐ |
| account-migration.13 | Ownership audit of every service (owner, login, recovery, MFA, billing, plan) | Register started (private) | Fill the blanks | ☐ |
| account-migration.14 | GitHub: Stellr organisation, transfer the repo, make it private, CODEOWNERS to an org team, reconnect Vercel Git, check Actions minutes | Checked 10-Nov: repo still under the personal account, public, 0 forks | Transfer to the Stellr org, then make it private | ☐ |
| account-migration.15 | Redact older docs and PR bodies that predate the personal-data rule | After .14 | Supersedes `public-repo-personal-data.3` and `worktree-cleanup.4` | ☐ |
| account-migration.16 | Delete old CI `playwright-report` artifacts | Done 11-Nov: no `playwright-report` artifacts remain |  | ☑ |
| account-migration.17 | Vercel → org-owned Pro team (`docs/RUNBOOK-vercel-pro.md`) | Done (owner, 10-Nov) |  | ☑ |
| account-migration.18 | Supabase and Clerk → org-owned organisations with work-email owners | Done (owner, 10-Nov) |  | ☑ |
| account-migration.19 | Remaining services; registrar and DNS last | Done 10-Nov, Sanity included. Owner decision: the domain registrar and DNS account stays on the owner's personal login |  | ☑ |
| account-migration.20 | Second admin and break-glass on critical accounts; org password manager | Owner decision | | ☐ |
| account-migration.21 | Fill governance slots: incident-response deputy, counsel, insurer; leaver procedure; program owner | Owner decision | Update `docs/compliance/*` | ☐ |
| account-migration.22 | Continue the S5 multi-tenant build on the Team account from its transfer handover (wave 6: restore the bundle, Lane A reviews and fixes, ship A → C → D) | Session idle at the switch; bundle verified and archived | Read the private copy of the S5 handover first | ☐ |
| account-migration.23 | Continue the Ad Grants follow-ups on the Team account (`ad-grants-rebuild.1`–`.11`) | Session idle at the switch; close-out merged (#609) | First-serve check on 13-Nov | ☐ |
