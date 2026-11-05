# Playwright report exposure — 2026-11-05

Slug: `playwright-report-exposure`. Handover: `HANDOVER-playwright-report-exposure-2026-11-05.md`. Doc snapshot: `1OC1HZRlWV5JY7twUlLwIpaoyES0L1pQopZOKSXJWKdE`.
PR #527 → `dev` as `2443fb9b`; not promoted. Migration: none.

The public `playwright-report` artifact carried live Clerk dev-instance session tokens. CI now ends each run's fixture sessions before any upload, uploads only on failure, and signs in without a password.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| playwright-report-exposure.1 | Delete the old reports | 88 artifacts still on GitHub on 5 Nov; only 3 were opened in the audit. Their sessions are revoked, but the files still hold other data (handover, "What the audit found"). | Owner runs the delete command in the handover. Agents may not permanently delete. | ☐ |
| playwright-report-exposure.2 | Fix on `main` | On `dev` only. | The next promote carries it. | ☐ |
| playwright-report-exposure.3 | Revoke step in the #525 CI layout | Proven by step outcomes on `dev` run 42030301231 (`0106e78f`, manually dispatched): revoke step success, 5 sessions recorded, upload skipped on a passing run. | None. | ☑ |
| playwright-report-exposure.4 | Report upload on a real failure | Has not run since the change. Run 41968184945 passed, so upload was skipped as designed. | Check the step outcomes on the first real `e2e-tests` failure. | ☐ |
| playwright-report-exposure.5 | Recurring 404 | One recorded session returned 404 on the first CI run and again on run 42030301231 (4 revoked, 0 ended, 1 missing). Run 41968184945 had 4 revoked, 1 ended, 0 missing. Cause unknown. The one unrevoked session may be the sign-out spec's, but a local watch of a signed-out session read `removed` for at least 8 minutes, so this is unproven. | Investigate if "No longer at Clerk" exceeds 1 in the step log. | ☐ |
| playwright-report-exposure.6 | Fixture passwords | None in the 3 reports opened. Re-run attempts of artifacts 13274093888 and 13269932776 are unread, so not ruled out. The suite no longer signs in with them. | Owner decides whether to change `E2E_*_PASSWORD`, then remove `passwordVar` and those secrets. | ☐ |
| playwright-report-exposure.7 | Tokens in job logs | Clerk's helper can log tokens in public job logs when a sign-in fails. Revoked tokens are dead. | Check the log the next time a sign-in fails in CI. | ☐ |
| playwright-report-exposure.8 | `pd-credentials` flake | `e2e/core/pd-credentials.spec.ts:37` flaked once; not investigated. | Look at it if it recurs. | ☐ |
