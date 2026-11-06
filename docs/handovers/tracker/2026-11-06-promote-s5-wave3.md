# Promotion of S5 wave 3 — 2026-11-06

Slug: `promote-s5-wave3`. Handover: `HANDOVER-promote-s5-wave3-2026-11-06.md`. Doc snapshot: `1pRdom9qGPWvQ7ALqLS6On3Fuw5Pj_3D8rw5Ibl-6JM4`.
Promoted in #561 (`028bea6e`), record #568 (`0e41ed15`). Crash fix #567 → `dev` as `063d9cb3`. Migrations: five on production, listed in row `.2`.

Group invoices, the sign-in rule on the registration forms and its crash fix, Active CPU phase 2, the proxy matcher and S5 wave 3 are live on production.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| promote-s5-wave3.1 | Promotion live | `dpl_4wSe9VHvuNrFxXmFeW9gWGmQrW9i` READY for `028bea6e`. www 200, app 307 to /sign-in, cron guards Unauthorized, tenant tree 404, gated paths 404 signed out, including with a forged header. No runtime errors or `app_errors` at 22:15 UTC, 33 minutes after the merge, with little traffic | None | ☑ |
| promote-s5-wave3.2 | Five migrations on production | `20261105190000_group_invoice_sync` before the merge. C0b `20261106070722`, `…724`, `…726`, `20261106074112` after it, with the owner's yes, through the Supabase MCP. Ledger realigned: `db:status --prod` reads 234 rows, with only the two September entries pending. Cutover D2 and I at 0 on all 10 tables, guards enabled, `security_checks.sql` 0 rows. Function sources, policies, triggers and grants hash equal to `dev`, apart from `.13` | None | ☑ |
| promote-s5-wave3.3 | **HIGH** C0b trigger on a real write | 0 participants written since the migrations, read at 22:15 UTC. It is in log mode and built never to refuse a write | After the first participant row, confirm `tenant_id` is set and `app_errors` is clear | ☐ |
| promote-s5-wave3.4 | **HIGH** Minnesota corrected invoice | The fix is live. The invoice is still open for 17 places, not 15. Same as `group-invoice-any-changes.2`, which holds the steps | The owner clicks "Send corrected invoice" and checks 15 places at $1,236.75 and the old invoice void | ☐ |
| promote-s5-wave3.5 | **HIGH** Typed sign-in and a new login | Never witnessed. Sessions in the witness run came from Clerk's testing token, and an agent may not make an account on Clerk's hosted service. The return through `/account/onboarding` was seen; `<SignIn>`'s own redirect after a typed sign-in was not | The owner signs in by typing from a registration page, and makes one new login | ☐ |
| promote-s5-wave3.6 | Links not clicked | The confirmation page's "Member Portal" and "Manage Your Team" were not clicked anywhere; a guard test and the golden diff cover them. On production only "Sign in first" was clicked. No e2e spec clicks any of these links | Click "Member Portal" after the next group registration | ☐ |
| promote-s5-wave3.7 | **HIGH** Crons on production | 0 `cron_runs` since the merge, read at 22:15 UTC. The Stellr-or-NULL filters and new reads have never run in a real cron, because crons decline on `dev`. `group-invoice-sync` has never run | After the next daily run, compare `cron_runs` with the previous day's | ☐ |
| promote-s5-wave3.8 | First unpaid roster change | The 2-minute wait has never run on Vercel. Same as `group-invoice-any-changes.4` | At the first change, expect one new invoice about 2 minutes later and `invoice_sync_due_at` back to null | ☐ |
| promote-s5-wave3.9 | Sanity webhook | Last proven 16 Oct, and caches now last 6 hours. Same as `active-cpu-phase-2.2` | One test publish from Studio | ☐ |
| promote-s5-wave3.10 | Stripe price events | With the owner's yes, 4 events were added to the live endpoint. The response lists 8, enabled. None delivered yet | Read the endpoint's log after the next price change | ☐ |
| promote-s5-wave3.11 | `/api/img` on production | CDN headers and delete-by-tag are unproven | Read the headers; use Part C of the privacy runbook at the first real removal | ☐ |
| promote-s5-wave3.12 | Active CPU | Not measured since this promotion. 78% on 5 Nov | Read the Usage page after a day of traffic | ☐ |
| promote-s5-wave3.13 | `service_role` EXECUTE differs | True on production and false on `dev` for `participants_assert_eligible`, `registrations_assert_eligible` and `tenancy_inherit_tenant_id`. The files do not revoke it. Cause not traced. Trigger functions run only as triggers, and `security_checks.sql` is clean | Trace it only if S6's permission model depends on it | ☐ |
| promote-s5-wave3.14 | Dev test leftovers | One Google Sheet and two DocuSign demo envelopes remain from the witness run, with test names only; IDs in the Doc. Its database rows and test Clerk user were removed and read back. No email was sent | Trash the Sheet and void the envelopes | ☐ |
| promote-s5-wave3.15 | Owner review of code-owned files | This promotion carried code-owned files with no GitHub review recorded, including `test/tenant-tree-no-analytics.test.ts` and `test/fixtures/flow-pages-golden.json` from #567, plus those in Lanes B and C. `promote-s5-wave2.8` also stays open | The owner reads the diffs | ☐ |
| promote-s5-wave3.16 | C0b owner decisions | The shared `participants_membership_id_seq` counter and the composite FK are undecided, as listed in `docs/TENANCY-S5.md` | Decide before the first non-owner tenant | ☐ |
| promote-s5-wave3.17 | Typed organiser name | Signed in, an organiser's typed name goes on the registration, participant and agreement, while the account keeps its own. Seen on `dev` | The owner decides whether the account's name should win | ☐ |
| promote-s5-wave3.18 | Flaky e2e tests | 3 and 1 in the two suites at `063d9cb3` on the PR, 0 in the same commit's push run, 1 at #567. All passed on retry. Three were `page.goto` waits. The course-creation 403 in `training-builder.spec.ts` stays unexplained | Look only if one repeats | ☐ |

## Closes

- `group-invoice-any-changes.1`: migration read back on production before the merge, and #554 promoted in #561.
- `proxy-matcher-gated-prefixes.1`: #553 promoted in #561; gated paths read 404 signed out, including with a forged header.
- `active-cpu-phase-2.1`: the Stripe API response for the live endpoint lists the 4 events. Delivery is `.10`.
- `active-cpu-phase-2.3`: #553 and #556 promoted in #561. `active-cpu-phase-2.2` was not closed first: see `.9`.
- `promote-s5-wave2.14`: `63a1187c` is an ancestor of `origin/main`.
