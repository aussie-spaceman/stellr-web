# Group invoices: any number of changes — 2026-11-05

Slug: `group-invoice-any-changes`. Handover: `HANDOVER-group-invoice-any-changes-2026-11-05.md`. Doc snapshot: `1C7r2rMRkTmgmG3rHHgg2n6XBqo1134O1nptzK8pD_mY`.
PR #554 → `dev` as `82069215` (`dpl_Fx2enSPRp4zH8sYW4rzysFpz6isW`, READY); **not promoted**: promotion is in a separate session. Migration: `20261105190000_group_invoice_sync.sql` (dev only).

A group's unpaid invoice can now follow any number of roster changes. When Stripe refuses a revision the invoice is replaced with a new chain, an admin can "Send corrected invoice", and updates wait for 2 minutes of quiet so a burst is one email. Seat counts use compare-and-set, and a per-group lease serialises changes to the main invoice.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| group-invoice-any-changes.1 | Promote #554 | On `dev` only. Production has no `invoice_sync_*` columns (read 5 Nov) | Promotion session: apply the migration to production BEFORE the code merges, with David's yes on the SQL. Without it every unpaid roster change fails to schedule and alerts staff. `test/cron-scope.test.ts` is code-owned, so `main` may need David's review | ☐ |
| group-invoice-any-changes.2 | **HIGH** Correct the Minnesota group's invoice | Registration `0e416e3b-8a3d-4348-b1fb-88e4f3873ff9`: `2EFXPOSM-0004` open and unpaid for 17 places, $1,401.65. Registration and roster are 15. Correct total $1,236.75 (15 × $97 less 15%); overpayment risk $164.90 (read from Stripe and production, 5 Nov) | After promotion: event roster → the group → "Invoice & discount…" → "Send corrected invoice". Check a new invoice is open for 15 places at $1,236.75 and `-0004` is void. If `-0004` is paid first, refund the 2 places by hand | ☐ |
| group-invoice-any-changes.3 | Tell the organiser (educator `58d6e89c-9955-4f93-8c39-752aa6cd44a1`) | The app told them a corrected invoice is coming. Nobody has replied. Names in the Doc | David decides whether to add a line once the corrected invoice is sent | ☐ |
| group-invoice-any-changes.4 | The 2-minute wait on Vercel | Proven on a local dev server through the real admin delete route: 2 removals, 1 invoice after the wait. Never run on Vercel; the seven routes involved set `maxDuration = 300` | First unpaid roster change after promotion: one new invoice about 2 minutes later, and `invoice_sync_due_at` back to null. If it stays due, the function was cut off, and the wait needs another home | ☐ |
| group-invoice-any-changes.5 | Daily `group-invoice-sync` cron | `syncDueGroupInvoices` drilled against Stripe test mode. The route has never been called | Day after deploy: read `cron_runs` for `group-invoice-sync` | ☐ |
| group-invoice-any-changes.6 | Paths with unit tests only | Not run against real Stripe: removing someone from an unpaid additional invoice, the "places came off" staff alert, an invoice paid while it is being replaced | Check each at its first real occurrence: the ledger row, and that no refund came from the group's main payment | ☐ |
| group-invoice-any-changes.7 | Known limits: keep or change | Changes more than 2 minutes apart email separately (5 Nov's five changes would have been 3 emails). Paid groups aren't batched: one additional invoice per add. Places that came off after the old invoice was paid are refunded by hand from a staff alert | David decides which, if any, to change | ☐ |
| group-invoice-any-changes.8 | Migration on dev | ☑ Applied via the MCP; ledger realigned, then re-read in a separate query as `20261105190000` | — | ☑ |
| group-invoice-any-changes.9 | Unaudited list grew by one | ☑ The new cron is listed, like the other 22. Label `audit-cap-grow` created (it did not exist) and set on #554; the CI cap step passed | — | ☑ |

## Closes

- Nothing closed outright. `group-billing-roster.7`'s "two emails for remove-then-discount" limit is narrower: a removal now waits 2 minutes, and a discount sent in that window also settles the pending update. Its row stays with its author.
- `group-billing-roster.1` now points at the wrong invoice: `2EFXPOSM-0003` is void and superseded. Read it with row `.2` above.
