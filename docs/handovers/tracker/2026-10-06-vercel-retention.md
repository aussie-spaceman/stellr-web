# Vercel Function Storage, second time — 2026-10-06

Slug: `vercel-retention`. Handover: `HANDOVER-vercel-retention-2026-10-06.md`. Doc snapshot: `1LzxTjeB_sGQ1I954Y-RDEIuSkMUZ2eKNCBrwix6V5m0`.
PR #307 → `dev` as `0db4284`; promoted in #310 (`564cfc7`). Migration: none.

Function Storage reached 75% because both projects keep builds for 30 days (not "3 + 3"), and the dev project held 146 builds, most of them docs-only. Three fixes are now live: old builds purged, dev retention cut to 1 week, and docs-only `dev` pushes no longer build on the dev project. The third is proven on Vercel.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| vercel-retention.1 | Function Storage after the purge | Not measured: no Claude surface can read the signed-in usage page (the same gap as 6.1 and 10.1). Before: 7.5 GB (75%), 6 Oct. | David reads https://vercel.com/stellreducation/~/usage → Function Storage and writes the figure into the handover §3. Allow a day or more of lag. | ☐ |
| vercel-retention.2 | Old builds purged | 22 prod and 140 dev READY builds removed 6 Oct with `--safe`. Read back right after: 10 prod, 5 dev. www 200, app 307, live aliases unchanged. | — | ☑ |
| vercel-retention.3 | Dev retention 1 week, cancelled 1 day | Read back from `/v9/projects` on 7 Oct: 7/7/1/7 days, `deploymentsToKeep: 10`. Prod is still 30 days. | — | ☑ |
| vercel-retention.4 | Docs-only `dev` pushes skip the dev build | Proven: `a1c38cc` (#311, a docs-only promotion record) → `dpl_AeAY4577…` CANCELED, log "docs-only change since 7f610c4 — skipped". #307's CI: verify and e2e both passed. | — | ☑ |
| vercel-retention.5 | Steady state stays well below 10 GB | Arithmetic only: ~2.5 GB prod (30 days) + ~1 GB dev (7 days) ≈ 3.5 GB. READY on 7 Oct: prod 11, dev 9. | If another usage alert arrives, count READY per project first. If prod is the bulk, set its retention to 2 weeks with the same `deployment-expiration` call (keeping `deploymentsToKeep` ≥ 10 for rollback depth). | ☐ |
| vercel-retention.6 | Sanity Studio out of the function bundle (~10 MB per build) | Deferred by David, 6 Oct. Row 6.5's trigger has fired. | When picked up: host Studio with `sanity deploy` and drop `/studio/[[...tool]]`. | ☐ |
| vercel-retention.7 | Vercel Pro decision | Deferred by David, 6 Oct. This was the fourth usage alert in three weeks, and Hobby is for non-commercial use. | David decides, using `docs/REC-vercel-deployment-volume-2026-09-28.md`. | ☐ |
