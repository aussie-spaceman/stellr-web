# Promotion of S5 waves 1 and 2 — 2026-11-05

Slug: `promote-s5-wave2`. Handover: `HANDOVER-promote-s5-wave2-2026-11-05.md`. Doc snapshot: `14MQexFmactsNywZdNvyvWT_SEbBckAdsLqcdS0dxNSE`.
Promoted in #548 (`5386f5e7`), record #551 (`a4e7a34f`). Migrations: five, applied to production before the merge.

S5 waves 1 and 2, #549 and the CI work from 4 and 5 Nov are live on production. No real registration through the new code had been seen at 00:34 UTC on 6 Nov, because the owner waived the witnesses the plan asks for.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| promote-s5-wave2.1 | Promotion live | `dpl_8RciJSV8HTJ5fM6oYqvKqWYxtoKM` READY for `5386f5e7`. www 200, app 307 to /sign-in, cron guard Unauthorized, tenant tree 404, proxy on pages and not on a static file. No runtime errors or `app_errors` at 00:34 UTC, 20 minutes after the merge | None | ☑ |
| promote-s5-wave2.2 | Five migrations on production | Applied through the Supabase MCP with the owner's yes for each file and the route. Ledger rows realigned; `db:status --prod` read 229 rows, with only the two September entries pending. Objects and grants read back; `security_checks.sql` returned zero rows | None | ☑ |
| promote-s5-wave2.3 | Real registrations through the new code (HIGH) | None seen: 0 participant rows since the merge at 00:34 UTC. The owner waived the witnesses for individual, group by invoice, group by card and group-join. Coverage is unit and characterisation tests plus the e2e suite | Read the first real registrations at Nevada on 6 Nov. Roll back to `dpl_3h276Wpetw1DC1p87kYugu2yp7Nu` if a join is wrongly refused | ☐ |
| promote-s5-wave2.4 | #549 join-link journeys (HIGH) | Live. No browser run and no e2e spec covers them. The owner chose to merge without its three witnesses and its device check | On `dev`: a returning member's join by sign-in, a new login's return, the organiser's add for someone who needs a parent. On a real device: a reload during Clerk's email code step | ☐ |
| promote-s5-wave2.5 | Eligibility trigger on a real write | Live on `participants`, `registrations` and `events`. No write confirmed through it. The mirror is empty, so writes take the no-row path. A failed lookup fails the write | After the first participant row since the merge, confirm it landed and `app_errors` has no 23514 | ☐ |
| promote-s5-wave2.6 | `prod-migrations` environment | This session's run 42128407252 created it. It has no reviewers, no branch rule and no secret. The run stopped before touching the database. `docs/RUNBOOK-agent-controls.md` §7 is not proven | Owner adds reviewers and the branch rule, then the secret, then proves §7 | ☐ |
| promote-s5-wave2.7 | Events mirror on production | 0 rows on 5 Nov, so the S5 parity query means nothing there | Owner runs `scripts/backfill-events-mirror.ts --apply --production`, then the parity query | ☐ |
| promote-s5-wave2.8 | Owner review of #525 and #526 | `e2e-apt-cache.5` and `e2e-local-stack.6` asked for this before promoting. This session did not read those rows or raise them until close-out, so both reached `main` unreviewed. Both touch CODEOWNERS files | Owner reads the two diffs | ☐ |
| promote-s5-wave2.9 | Team page linked-row view | Never opened in a browser. 0 production rows have `details_from_member` true | Open the page after the first Member ID linked registration | ☐ |
| promote-s5-wave2.10 | Production smoke run | The read-only e2e smoke run was not done. `verify:prod` was not run, because `.env.local` holds dev keys here and no Stripe or DocuSign contract changed | Owner decides whether to run it, for registration flows only | ☐ |
| promote-s5-wave2.11 | Active CPU after matcher entry 4 | Not measured. It read 90% on 21 Oct, and at 100% Vercel pauses every project | Read the Usage page after a day of traffic | ☐ |
| promote-s5-wave2.12 | S5 flags on production | Not read: the Vercel connector answers 403 on env listing. All default to off, and no flip was part of this promotion | Owner confirms none is set in the dashboard | ☐ |
| promote-s5-wave2.13 | Flaky tests in the promotion runs | `privacy-requests.spec.ts:54` in `e2e-tests` at `8fc39814`, and `survey.spec.ts:243` in `e2e-local` at `e8083eb2`, once each. Neither investigated | Look only if either repeats | ☐ |
| promote-s5-wave2.14 | #550 on `main` | Merged to `dev` as `63a1187c` after the promotion. The next one carries it | Confirm `63a1187c` is in `origin/main` after the next promotion | ☐ |

## Closes

- `e2e-lock-queue.4`: `bed84259` is an ancestor of `origin/main`.
- `event-manager-e2e.1`: `9fe3802a` (#523) is an ancestor of `origin/main`.
- `playwright-report-exposure.2`: `2443fb9b` (#527) is an ancestor of `origin/main`.
- `e2e-speedups.4`: `main` push run 42135360757 read. `e2e` success; `changes` logged that the tree already passed in run 42132981461, so the suite skipped as designed.
