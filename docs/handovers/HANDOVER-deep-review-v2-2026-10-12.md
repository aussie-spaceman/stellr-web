# Handover — Deep review v2, full remediation (2026-10-12)

## Context
A second whole-codebase `deep-review` was run on `dev` `9bd209fb` (= prod after the
first review's High promotion). It re-triaged every v1 finding against current code and
did a fresh pass with 9 domain reviewers. The report lives **only** at
`code-review-report-v2.md` in the repo root, **git-excluded** (`.git/info/exclude`) because
the repo is PUBLIC — do not commit it or quote exploit detail into git. Per-area detail:
`scratchpad/review2/*.md`.

The review found the Critical/High set from the first review was genuinely closed in code,
plus a **new Critical** (Next.js 16.2.9 inside a critical RCE advisory range — next/og
ImageResponse RCE, Image-Optimization AVIF RCE, App-Router middleware bypass bearing on the
admin gate) and a cluster of **sibling-gap Highs**: the first review's safeguarding fixes
each patched their exact cited line and missed an adjacent path (volunteer removal, mentor
reassignment, `can_read_chat_channel` vs `can_read_space`).

## What shipped (all LIVE in prod)
The **entire v2 report** — 5 Criticals + ~32 Highs + ~48 Mediums + ~60 Lows — across four
promotions:

| Promotion | PR | Prod merge | What |
|---|---|---|---|
| Recommended cut (Criticals + sibling-gap Highs + DB-N3 lint + owner item-6) | #378/#379 | `28b026e6` | Next 16.2.9→16.4.0, AUTH-N2 register rate-limit, REG-11, PAY-1/PAY-5, BG-5/MEM-N1/DB-N1/QUALTEST-N1, DB-N3 migration-security lint, MP-7 7-yr purge cron, CO-2 log marker, INT-2/PUB-4 Resend budget |
| Mediums | #391 | `f803ce7a` | ~48 Mediums across DB/BG/DSES/MPREG/MEM/PAY/AUTH/INT/PUB/QUALTEST |
| Lows | #398 | `8b53af1e` | ~60 Lows across all areas |
| tar security pin | #401 | `e1a49ba7` | pin transitive `tar`→^7.5.22 via npm overrides (clears node-tar DoS advisory) |

**9 migrations applied+verified on prod** (always before the code that needed them):
- `20261010195052_can_read_chat_channel_honour_deactivation` (anon denied, authenticated kept)
- `20261011004224_shared_email_budget` (`email_send_quota` + `bump_email_quota`; **anon-exec
  verified false** — note the all-three `REVOKE … FROM PUBLIC, anon, authenticated`)
- `20261012165024_participant_retention_set_null` (4 FKs CASCADE→SET NULL)
- `20261012165038_participants_reg_email_unique` (partial unique index; 0 prod dups pre-checked)
- `20261012173622_registrations.checkout_session_id`
- `20261012173636_participants.pay_token` (+unique)
- `20261012173639_credit_redemptions` reservation cols+indexes
- `20261012173642_event_refunds` cancellation unique (0 prod dups pre-checked)
- `20261012203041_can_read_space_align_app_resolver` (3rd CREATE OR REPLACE of can_read_space:
  DB-2 guards + archived-deny + event-linked tier-suppression)

Prod verified after every promotion: www 200 · app 307→/sign-in · cron 401 · Stripe webhook 400.

## Hardening worth knowing about
- **DB-N3 lint** (`scripts/check-migration-security.mjs`, wired into `lint:migrations`/prebuild,
  `test/migration-security.test.ts`): every new SECURITY DEFINER fn must
  `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` (all three). RLS helpers that must keep
  `authenticated` carry a `-- rls-helper:` annotation. This caught a real prod-reachable gap —
  see below.
- **SECURITY CATCH:** `bump_email_quota` first revoked only anon+authenticated; anon could
  STILL execute it via Postgres's default **PUBLIC** grant. The lint passed it. Fixed the
  migration + hardened the lint to require all three roles corpus-wide + regression test.
  **LESSON: a new definer fn needs all three revokes, and you must verify `has_function_privilege`
  = false on the DB — do not trust the lint alone.**

## Not verified / live-but-unexercised
Routes and guards respond correctly to curl, but these behaviour changes have not run against
real prod data yet: the chat-channel deactivation RLS path (v2.2), the $0 group-invoice path
(v2.3), the shared Resend budget under a real 429 (v2.4). See tracker.

## Parked by owner choice — NOT done
- **INT-3** roster Sheets world-editable — owner: manageable risk at current scale.
- Owner-decision follow-ups (tracker v2.5–v2.19): PAY-10, PAY-N4, PUB-8, QUAL-4, QUAL-7, ES-6,
  ES-8, AUTH-10, AUTH-4, TEST-9, TEST-12, QUAL-12, MEM-11, MEM-15/DB-4, event_manager e2e fixture.
- The 2 pre-existing Sept prod migrations `20260910140426`/`140427` remain pending (v2.20) —
  predate this effort, separate reconciliation.

## Gotcha carried forward
Vercel's GitHub **commit-status integration stopped posting** mid-effort — `gh api
.../commits/<sha>/status` shows no Vercel context even when the prod build succeeded. For this
project right now, **trust the Vercel API (`list_deployments` / `get_project.latestDeployment`)
as the deployment source of truth**, not the gh commit status. Builds can take >3 min.

## Where to look
- Report: `code-review-report-v2.md` (root, git-excluded). Area detail: `scratchpad/review2/*.md`.
- Running log in memory: `deep-review-v2-2026-10-10.md` (+ `deep-review-2026-10-08.md` for v1).
- Doc snapshot: https://docs.google.com/document/d/1GDQhSZK0bq6CEI5B10qTi_yATzRnTLRMYUbNeqviJqo/edit (copy; the tracker file is the source).
- Combined open list across all sessions: `npm run tracker`.
