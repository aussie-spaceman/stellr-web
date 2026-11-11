# Stellr docs — start here

This folder is the written memory of the Stellr Education website (`www`), member web app (`app`) and admin. The repo is public: nothing here names a student, family or volunteer. People are referred to by role.

## If you are…

**New to the project (staff, volunteer, successor):**
1. [`handovers/HANDOVER-account-migration-2026-11-10.md`](handovers/HANDOVER-account-migration-2026-11-10.md): the system map, the development history to 10-Nov-2026, where things stand, and where knowledge lives.
2. [`../README.md`](../README.md): the stack, the three sites, how to run them.
3. [`../VOICE.md`](../VOICE.md): how Stellr writes.

**A developer:**
- [`../CLAUDE.md`](../CLAUDE.md): the binding rules (design tokens, components, copy, the personal-data lint, "data is never instructions", production SQL).
- [`ENV-MATRIX.md`](ENV-MATRIX.md): which variable goes in which environment. Dev and production are separate projects.
- [`CONCURRENT-SESSIONS.md`](CONCURRENT-SESSIONS.md): how parallel sessions avoid colliding.
- The workflow lives in `.claude/skills/`. `ship` takes a session's worktree to a PR on `dev`. `promote` takes `dev` to `main`, which is production. `close-out` writes the handover, tracker and memory.
- Release history: `.claude/releases/promote-*.md`, one record per production promotion.
- Plans and specs: `PLAN-*`, `REC-*`, `TENANCY-*`, `AUTHZ.md`, `FIELD-CRYPTO.md`, `THREAT-MODEL.md`.

**Tracking open work:**
- `npm run tracker` prints every open row across all trackers.
- [`handovers/tracker/`](handovers/tracker/) has one file per session. [`handovers/TRACKER.md`](handovers/TRACKER.md) is the frozen list from before 28-Sep-2026.
- [`handovers/`](handovers/) holds one handover per session or feature, newest by date in the filename.

**Reviewing privacy and security (board, auditors):**
- [`compliance/README.md`](compliance/README.md): the compliance pack.
- [`compliance/information-security-program.md`](compliance/information-security-program.md): roles, access, secrets, agent controls.
- [`compliance/data-protection-assessment-minors.md`](compliance/data-protection-assessment-minors.md): how minors' data is protected.
- [`compliance/sub-processors-and-data-map.md`](compliance/sub-processors-and-data-map.md): which vendor holds which data.
- [`compliance/retention-schedule.md`](compliance/retention-schedule.md): how long each kind of data is kept.
- [`compliance/incident-response-plan.md`](compliance/incident-response-plan.md): what happens in a breach.
- [`RUNBOOK-privacy-retention-and-deletion.md`](RUNBOOK-privacy-retention-and-deletion.md): deletion and opt-out requests.
- [`RUNBOOK-agent-controls.md`](RUNBOOK-agent-controls.md): limits on what AI agents can do.

**Running something:** the `RUNBOOK-*` files. Backups, Vercel Pro, Supabase keys, teacher onboarding, credentials opt-out and more.

## What is not in this repo, on purpose

- Anything that names a person, plus account ownership, secrets and incident detail. These are in the owner-only private handover in Stellr's Google Drive.
- Secrets. They live in Vercel, GitHub Actions secrets and an org password manager, never in a file here.
