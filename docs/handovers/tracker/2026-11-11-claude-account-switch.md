# Claude account switch: gate, clean-up and promotion — 2026-11-11

Slug: `claude-account-switch`. Handover: `HANDOVER-claude-account-switch-2026-11-11.md`. Doc snapshot: `1zuHvn9rGkmDsdGS-At4V86r3CMc4mioeR_fWN5wFhUI`.
PRs #614, #617, #618, #619, #627 → `dev`; promoted in #620 (`ccf45694`); record #623. #628 on auto-merge at close-out. Migration: none.

The Team account passed the Phase 4 gate; node-forge 1.4.3 and the `docs/` personal-data redaction are on production; private handover material is in `~/Documents/Claude/Handover/`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| claude-account-switch.1 | Phase 4 gate (memory, web-gate log, connectors, skills, scheduled tasks, scorecard routine, living artifacts) | Each item checked 10–11 Nov; connector calls, task list, routine test run and artifact URLs all read back | | ☑ |
| claude-account-switch.2 | `prod-migrations` environment approval gate, then the `RUNBOOK-agent-controls.md` §7 proof | Secret present; 0 protection rules, admin bypass on, any branch (checked 11 Nov) | Owner adds a required reviewer, limits to `dev`/`main`, turns off admin bypass; then run §7 and write the date | ☐ |
| claude-account-switch.3 | claude.ai data export and newer S5 files into an encrypted archive in the restricted Drive folder | Local only, owner-only permissions, in `~/Documents/Claude/Handover/s5-transfer-2026-11-10/` | Owner encrypts and uploads with a delete-by date (also `account-migration.2`, `.3`, `.5`) | ☐ |
| claude-account-switch.4 | Motion API key out of the desktop config into the keychain | Script `~/.claude/motion-move-key.sh` and launcher `~/.claude/motion-mcp.sh` ready; not known to have run | Owner runs the script, restarts the app; check Motion answers | ☐ |
| claude-account-switch.5 | Personal data in code, tests, a migration comment and a seed script (about 80 files outside `docs/`) | Found by the #619 audit; untouched | Code PR replacing real names and emails with fixtures | ☐ |
| claude-account-switch.6 | Personal data in 23 PR titles and bodies | PR numbers in the Doc snapshot | Owner decides; editing needs the old revisions deleted too | ☐ |
| claude-account-switch.7 | GitHub org transfer, private repo, CODEOWNERS team, CLI re-login | Repo still under the personal account and public, 0 forks (11 Nov) | Owner transfers and makes private; then update `origin` and CODEOWNERS | ☐ |
| claude-account-switch.8 | Downloads: 26 OWNER DECIDES items; empty the Trash after checking the Drive copies | 85 in Drive (counted), 109 in Trash, 26 in place | Owner decides the 26 and empties the Trash | ☐ |
| claude-account-switch.9 | e-sign seal on production with node-forge 1.4.3 | Tests pass; not yet exercised on production | Check the next real signature completes | ☐ |
| claude-account-switch.10 | Vercel connector refused listing deployments (403) | CLI works; connector access to projects unknown (also `s5-programme.17`) | One read-only `list_projects` call; re-authorise if empty | ☐ |
| claude-account-switch.11 | Ad Grants scheduled tasks run unattended | Saved in Auto mode; 0 runs so far | Read the 13 Nov first-serve run result | ☐ |
| claude-account-switch.12 | Remove `.claude/worktrees/handover-path` | #628 on auto-merge | After #628 merges: `git worktree remove` and `git branch -D docs/handover-path-2026-11-11` | ☐ |
| claude-account-switch.13 | Docs-only changes on `dev` (#623, #627, #628, this close-out) reach `main` | Owner decision: ride the next promotion | Next promotion | ☐ |
| claude-account-switch.14 | Memory notes: 3 references left in place because the person's role was unclear | Details in the Doc snapshot | Owner says whether to replace them | ☐ |
| claude-account-switch.15 | One local location for handover material | `~/Documents/Claude/Handover/` (mode 700) with README; old folders gone; live references updated (checked by grep 11 Nov) | | ☑ |

## Closes

- `account-migration.1`, `.6`, `.7`, `.8`, `.10`, `.11`, `.16`: ticked with evidence in #618 and #627 (this session edited that tracker file; see the handover's gaps).
- `account-migration.17`, `.18`, `.19`: owner confirmed done on 11 Nov; ticked in #618.
- `account-migration.4`: memory curated 10 Nov (11 files, names replaced by role, connector IDs updated); ticked in #618.
- `public-repo-personal-data.3`: the three rescued 7-Oct files redacted in #619.
