# Handover — Vercel Function Storage, second time (6–7 Oct 2026)

**For:** whoever gets the next Vercel usage email, or touches
`scripts/vercel-ignore-build.sh` or the projects' retention settings.
**Prompted by:** Vercel's email of 6 Oct, 19:47Z: team `stellreducation` had
used **75% of Function Storage (10 GB)**. That is the same meter and the same
level as on 15 Sept (`HANDOVER-vercel-function-storage-2026-09-15.md`).

## 1. Why it came back

The 21 Sept handover said Vercel's Hobby retention keeps "3 production + 3 of
any type" per project. **That was wrong for these projects.** Read from
`/v9/projects/<id>` on 6 Oct:

| Project | `deploymentExpiration` (6 Oct) | READY builds held |
|---|---|---|
| `stellr-web-dev` | 30 days, all types; `deploymentsToKeep: 10` | **146** `dev` builds, oldest 18 Sept |
| `stellr-web` | 30 days, all types; `deploymentsToKeep: 10` | 32 `main` builds, oldest 18 Sept |

7.5 GB ÷ 178 builds ≈ 42 MB of functions per build, which matches the 15 Sept
trace (47.6 MB). Bundles had not grown. The problem was the number of builds.

**82 of the 146 dev builds changed nothing but `docs/`, `.claude/` or root
`*.md`.** These were close-outs, handovers and promotion records, each
classified against its first parent. Every one built ~42 MB of functions on
the dev project.

## 2. What was done

1. **Purge (6 Oct, ~22:10Z).**
   - Deleted 22 prod builds (18–29 Sept) and 140 dev builds with
     `vercel remove <ids> --yes --safe --scope stellreducation`, which keeps
     anything that has an alias.
   - Kept the newest 10 on prod and the newest 5 on dev, plus the live
     deployments (`dpl_GfstBz…` prod, `dpl_5VQaEC…` dev) and the rollback
     targets in the #296 and #305 records. They were asserted out of the
     delete set.
   - Afterwards www returned 200, app 307 and the dev alias 302, and both
     aliases were unchanged. Counts read back: 10 READY on prod, 5 on dev.
   - Auto mode refused the first attempt because the IDs were read from a
     file. It passed once the IDs were printed and given inline.
2. **Dev retention: 30 days → 1 week; cancelled builds → 1 day.**
   - The call: `PATCH /v9/projects/prj_Nd2kmpMj3bBuXbSjc6teUdwh9gPO/deployment-expiration`
     with body
     `{"expiration":"1w","expirationProduction":"1w","expirationCanceled":"1d","expirationErrored":"1w"}`.
   - The `expirationDays*` names from the GET response are rejected with a
     400. Hobby accepts the change.
   - Read back 7 Oct: 7 / 7 / 1 / 7 days, `deploymentsToKeep: 10`.
   - Prod is unchanged at 30 days, to keep rollback depth.
3. **Docs-only dev pushes skipped (#307 → `dev` `0db4284`; promoted in #310
   `564cfc7`).**
   - On the dev project, `vercel-ignore-build.sh` diffs
     `VERCEL_GIT_PREVIOUS_SHA..HEAD` (the last *successful* dev build) with
     CI's docs-only pattern.
   - It builds whenever that cannot be resolved, and when the commit message
     contains `[build]`.
   - Prod is excluded on purpose: a docs-only push to `main` is how a missing
     production deployment is re-triggered (#197).
   - **Proven on Vercel:** `a1c38cc` (#311, the promotion record) →
     `dpl_AeAY4577…` **CANCELED**. Build log:
     `vercel-ignore-build: docs-only change since 7f610c4 — skipped`.
   - `docs/ENV-MATRIX.md` records all three changes. The 21 Sept handover now
     carries a correction of its retention claim.

## 3. What is not verified

- **The Function Storage figure after the purge has never been read.** No
  Claude surface here can load the signed-in usage page; this is the same
  gap as rows 6.1 and 10.1. Vercel says it will alert again at 100%.
- **What steady state looks like.** This is arithmetic, not measurement:
  - prod: ~2 builds/day × 30 days × 42 MB ≈ 2.5 GB
  - dev: ~3–4 code builds/day × 7 days (floor of 10) × 42 MB ≈ 1 GB
  - Total: ~3.5 GB, against the 7.5 GB that triggered the alert.

## 4. Deferred by David (6 Oct)

- **Sanity Studio out of the function bundle** (row 6.5's trigger, "if
  Function Storage climbs again", has now fired). It is ~10 MB, about 20% of
  each build.
- **Vercel Pro.** This was the fourth usage alert in three weeks, and Hobby is
  meant for non-commercial use. The write-up is
  `docs/REC-vercel-deployment-volume-2026-09-28.md`.

Tracker: `tracker/2026-10-06-vercel-retention.md`.
