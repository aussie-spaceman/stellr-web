# Handover: Playwright report exposure — 2026-11-05

Tracker: `tracker/2026-11-05-playwright-report-exposure.md`.

**Status:** the fix is on `dev` as `2443fb9b` ([#527](https://github.com/aussie-spaceman/stellr-web/pull/527)). It is not on `main`; promotion is happening separately. No migration.

## Context

This repo is public, so any signed-in GitHub user can download a CI artifact for its retention period. The question was whether the `playwright-report` artifact could expose credentials or personal data.

## What the audit found

Three of the 88 reports were opened, all from the Clerk **development** instance.

- **Session tokens: yes.** The HTML report's step data holds the full `__clerk_db_jwt` for each fixture sign-in, on passing tests too. Sessions were active with about 7 days left. Takeover is strongly indicated but was not tested by replaying a token.
- **Passwords: none found, not ruled out.** A retried sign-in would have put the fixture password in the trace, because it was passed as an `evaluate` argument. Re-run attempts of artifacts 13274093888 and 13269932776 were not read.
- **API keys: none** (`sk_test_`, `sb_secret_`, `whsec_`, `service_role`).
- **Personal data:** the owner's own email aliases, `example.*` records and 3 phone numbers that were not classified.
- **Production:** not affected. Every session token came from the dev instance. `CLERK_SECRET_KEY` and `SUPABASE_SECRET_KEY` do not need rotating.

## What changed

- `e2e/fixtures/sign-in.ts`: `signInAs` uses a server-minted, one-use ticket, so no password reaches the browser.
- `e2e/fixtures/session-ledger.ts`: each session id is recorded as Clerk returns it, so a sign-in that fails later is still covered.
- `scripts/revoke-e2e-sessions.ts`: ends only the recorded sessions, refuses anything but an `sk_test_` key and prints counts only. A 404 counts as gone, and it is an error if every session is gone. `--all-fixtures` signs out a running e2e job, so check for one first.
- `.github/workflows/ci.yml`: revoke step runs always. Upload condition is `failure() && steps.revoke-sessions.outcome == 'success'`. #525 later moved both into the `e2e-tests` job.
- `test/ci-e2e-report-exposure.test.ts`: guards step order, upload condition, key guard and revoke behaviour.

Outside the PR, 352 active fixture sessions on the dev instance were revoked by hand: 269, then 74, then 9.

## Verified

- Run 41968184945 on `2443fb9b`: 189 passed, 43 skipped. 5 sessions recorded: 4 revoked, 1 already ended, 0 missing. Upload skipped.
- At 05:00 UTC on 5 Nov, Clerk showed 0 active fixture sessions. This was not re-checked after later runs.

## Not verified

- The revoke step has not run in the `e2e-tests` job since #525 (row `.3`).
- The upload path has not run on a real failure (row `.4`).
- Why one recorded session returned 404 on the first CI run (row `.5`).

## Trade-offs to remember

- Flaky runs pass, so their traces no longer upload. Debugging a flake means reproducing it or reading the job log.
- A missing ledger or failed revoke fails the job and uploads no report, so a Clerk API outage can block merges until a re-run.
- Re-running an older commit uses its old CI file, which can leave live sessions until they expire or someone revokes them.
- A red `e2e` with 0 steps was queue cancellation, not a test failure: re-run the job.

## Open items

Rows `.1`–`.8` in the tracker. The one that needs the owner now is `.1`, deleting the old reports, which cannot be undone:

```bash
gh api --paginate '/repos/aussie-spaceman/stellr-web/actions/artifacts?name=playwright-report&per_page=100' --jq '.artifacts[].id' | while read -r id; do gh api -X DELETE "/repos/aussie-spaceman/stellr-web/actions/artifacts/$id" && echo "deleted $id"; done
```
