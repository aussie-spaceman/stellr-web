# Handover: node-forge 1.4.3 bump — 2026-11-11

Tracker: `tracker/2026-11-11-node-forge-bump.md`.

## Context

On 10 Nov 2026 four advisories were published against `node-forge` 1.4.2
(GHSA-6889-vf6x-f3g5, GHSA-6cv4-p8m7-4r25, GHSA-j8rw-jp99-435v,
GHSA-w4xr-hqv8-ch44; 3 Medium, 1 Low), all fixed in 1.4.3. From then on the
`osv-scanner` job in the security workflow (step "Scan package-lock.json")
failed on every branch, `dev` included. It is not a required check, so nothing
was blocked. It was found while shipping #615, which changes no dependencies.

## What changed

- PR #616, squash-merged to `dev` as `65418f18`.
- `node-forge` is a **direct runtime dependency**, used by the e-sign seal
  (`lib/esign/native/seal.ts`, plus `scripts/esign-seal.ts`). `npm ls node-forge`
  shows no other path.
- `package.json`: `^1.4.0` → `^1.4.3`, so a reinstall cannot resolve 1.4.2.
- `package-lock.json`: regenerated with `npm install --package-lock-only`, which
  changed only `node-forge` (1.4.2 → 1.4.3).
- `osv-scanner.toml` untouched: the advisories have a fix, so the fix is the bump.

## Verified

- Locally: `npx vitest run lib/esign/native`, 13 files and 84 tests passed on 1.4.3.
- On #616, by step outcome: `osv-scanner / Scan package-lock.json`,
  `unit / Unit tests`, `verify-build / Build`, and
  `e2e-tests / Run npx playwright test` all succeeded.
- The security workflow on `dev` passed for `65418f18` (10 Nov, 23:19 UTC).

## Not verified / open

- **Not on `main` yet.** Promotion is running in a separate session. Until it
  lands, production still runs 1.4.2, and `osv-scanner` on `main` keeps failing.
  No e-sign envelope has been sealed on 1.4.3 outside the unit tests.
- This session's worktree (`.claude/worktrees/nervous-hellman-edabb9`) was
  merged from inside, so gh skipped the local delete. It goes at the next sweep
  run from the main checkout.

See the tracker file for row IDs.
