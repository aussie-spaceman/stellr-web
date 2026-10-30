# Scholarship cancellation — 2026-10-30

Slug: `scholarship-cancel`. Handover: `HANDOVER-scholarship-cancel-2026-10-30.md`. Doc snapshot: `1CmD66y6mhpZbLWJa8fg7xRtpxSv_Sn14VkQ0io7MeH8`.
PR #490 → `dev` as `13119444`; **not yet promoted** (promotion running in a separate session). Migration: `20261030201934_scholarship_cancellation` (dev applied and realigned 30 Oct; production not applied).

Admins can cancel an offered scholarship at any stage from `/admin/scholarships/[id]`. Withdrawing a registration, by any path through `executeDeletion`, cancels the live offers on it automatically. Nothing is emailed to the student. An unpaid registration gets the full fee back as its amount due; a confirmed one is left as it is.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| scholarship-cancel.1 | Production migration before the code | 30 Oct ~20:45 UTC: production has no `cancellation_source` column and no `20261030…` ledger row; no dev → main PR open | The promoting session applies `20261030201934_scholarship_cancellation` to production **before** merging (the code selects the new columns), then reads `db:status --prod` | ☐ |
| scholarship-cancel.2 | The stuck production offer is cancelled by the backfill | Application `b8233294-a67f-4cf2-8cc7-8e4b3dabfbc1` (student `7595d329-0780-4331-8294-84d7ab1748aa`) reads `offered`, 50%; its registration was withdrawn 20 Oct. Its offer link still applies the coupon. Name in the Doc | After `.1`: read the row on production, expecting `status = cancelled`, `cancellation_source = withdrawal`, `cancelled_at` = the registration's `withdrawn_at`. Then `/admin/scholarships/b8233294-…` shows "Cancelled automatically…" | ☐ |
| scholarship-cancel.3 | Admin cancel restores the full fee against a live price | Unit-tested; on dev the price is unreadable, so the fallback message showed. No production offer is currently unpaid-registered | On the first production cancel of an unpaid-registered offer: `registrations.amount_due_cents` equals the event's Stripe price, and the pay page shows that amount | ☐ |
| scholarship-cancel.4 | Self-withdraw by a scholarship holder auto-cancels | Same `executeDeletion` path proven on dev via `DELETE /api/admin/deletion` (soft); `/api/members/registrations/[id]/withdraw` not exercised with an offer; staff alert line never seen | On the first real self-withdrawal by a holder: the application reads `cancelled / withdrawal`, and the staff alert ends "Their N% scholarship was cancelled." | ☐ |
| scholarship-cancel.5 | Withdrawal hook fails open on a read error | `liveScholarshipOffers` logs and returns `[]` on error, so the withdrawal proceeds and the offer stays live with no alert | Decide: add a `notifyCommunityAdmins` on that error, or accept the log line | ☐ |
| scholarship-cancel.6 | Reimbursement retry after a cancel | `/api/admin/scholarships/[id]/refund` requires `status = 'offered'`, so a `manual_required` reimbursement cannot be retried once cancelled. No production row is in that state (30 Oct) | David decides whether a reimbursement still owed survives a cancel; if it does, let the retry route accept `cancelled` | ☐ |
| scholarship-cancel.7 | No undo for a cancel | By design: reinstating means a new application and offer | David says whether a "Reinstate" action is wanted | ☐ |
| scholarship-cancel.8 | Dev migration and ledger | ☑ 30 Oct: applied via MCP (`20261030202618`), realigned to `20261030201934`; `npm run db:status` no longer lists it as pending | — | ☑ |

## Closes

- `scholarship-offers.8` ("No 'withdraw offer' action"): the cancel action and the `cancelled` status are on `dev` in #490 and were exercised on dev through the real admin route. It is live once `scholarship-cancel.1` lands.
- `scholarship-offers.2` (waiting for that student's 50% payment): moot. Production read on 30 Oct shows the registration was withdrawn on 20 Oct, so no payment will come. The offer itself is cancelled by `scholarship-cancel.2`.
