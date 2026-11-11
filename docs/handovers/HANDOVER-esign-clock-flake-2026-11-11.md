# Handover: esign clock flake and promotion 2026-11-11b — 2026-11-11

Slug: `esign-clock-flake`. Tracker: `tracker/2026-11-11-esign-clock-flake.md`.

## Context

The session that verified #630 (CI Playwright apt offline install) started this one. A re-run of #630's `unit` job had failed only on one esign test, and a straight re-run passed. `unit` gates every browser job, so a unit flake skips all of them. The brief was to fix the flake in the test, without loosening what the test checks, and open a PR into `dev`.

## What changed

**#631 → `dev` as `48a7573d`** (squash, auto-merge at the owner's request). Only `lib/esign/tenant-sender.test.ts` changed.

- **Cause.** "Stellr's signing mail is unchanged" sends the same invitation twice (flag off, then on) and deep-equals the two mails. The `signer()` fixture stamps `token_expires_at` from the real `Date.now()`, but `sendInvites` gets a fixed `now`. `signNowUrlFor` turns the gap into a whole-second TTL, and `mintToken` puts `now + ttl` in the link. If the real clock crossed a second boundary between the two passes, the expiry and its HMAC differed by one. In CI run 43074913323 it showed as `.1794507880.…` vs `.1794507881.…`.
- **Fix.** That `describe` fakes `Date` only (`vi.useFakeTimers({ toFake: ['Date'] })`), at the same instant passed as `now`, and restores real timers afterwards. The assertion that the two mails are identical is unchanged.
- **Other esign tests.** No other test in `lib/esign/` compares two link-bearing mails exactly. `outbox.test.ts` uses the same `Date.now()` fixture, but its link checks only match the recipient id by regex.

**Promotion 2026-11-11b, PR #633 (`dev` → `main`), opened and not merged.**

- It covers `dev` at `dee57fa3`: #631, #630 (CI only), #626 (S5 status docs) and earlier close-out docs.
- No runtime change: no migrations, crons, environment variables, webhooks or app code.
- The rollback target is `dpl_FpFd3LNazBPczbwfgiAcT2Pn4oVv` (`ccf45694`, #620).
- The record lives in #633's body. It is not committed yet; promote Step 8 commits it.

## Verified

- Reproduced on purpose: moving the clock by more than a second between the two passes failed all three cases with the same one-second diff as CI.
- With the fix, 50 consecutive runs of the file had 0 failures. `npm run test` passed locally: 580 files, 11,962 tests.
- #631's CI was green, including `unit`.
- On #633's first head (`48a7573d`), every check passed. The `e2e-tests` and `e2e-local` step logs show `Run npx playwright test` succeeded. Step-level reads of `unit` and `verify-build` hit GitHub 502s, so only their job badges were seen.

## Not verified / open

- **#633's CI on the new head `dee57fa3`** was queued at close-out.
- **#633 itself:** the merge, the production deployment, the Step 7 checks and the Step 8 record and sync PR have all not happened. The merge needs the owner's yes.
- **#633 follows `dev`'s head.** Another session is shipping S5 wave 6 (#624 Lane C, #625 Lane A with migration A16). If either lands in `dev` first, #633 would carry S5 code and a migration to production. Check `git log origin/main..origin/dev` before merging. If it lists anything past `dee57fa3`, close #633 and promote again later, with A16 applied to production before the code.
- **#634** (Close-out playwright-apt-offline) is another session's close-out, open against `dev`. This session did not touch it.

## Process note

During the reproduction, a `git checkout` of the test file also discarded the uncommitted fix. The fix was re-applied and then verified, so nothing was lost. Next time, reproduce on a copy, or commit first.
