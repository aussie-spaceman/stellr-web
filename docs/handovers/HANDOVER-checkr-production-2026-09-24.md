# Handover — Checkr production cut-over (24 Sept 2026)

**Tracker (tickable):** https://docs.google.com/document/d/1rCsBVPjLQCMz366ehCwlJG87XX9iWUVUPS2D1wBK1L0/edit
**Canonical rows:** `TRACKER.md` 9.7 ☑, 9.8 ☐ (one step from done), 9.19, 9.20.
**Records:** #175 (cut-over), this PR (close-out).

## Where things stand

Checkr approved the production account on 23 Sept at 22:55Z (Melissa Rivera, "Stellr Education/Checkr API Auth Review Checklist"). Live reports come with that approval, so nobody needs to email clients@checkr.com.

**No application code changed.** The environment is chosen entirely by env vars (`lib/background-provider/checkr.ts:32`, `lib/env-guards.ts:61`).

The production values are on `stellr-web`, **Production scope only**:
- `CHECKR_API_KEY`: added by the owner.
- `CHECKR_BASE_URL=https://api.checkr.com/v1`
- `CHECKR_PACKAGE_SLUG=checkrdirect_basic_plus_criminal`
- `NEXT_PUBLIC_CHECKR_DASHBOARD_URL=https://dashboard.checkr.com`
- `BACKGROUND_PROVIDER=checkr`
- `CHECKR_WORK_LOCATION_STATE` is **deliberately unset**. That is the owner's decision: never assume a state.

Verified:
- **Health endpoint:** reads `"checkr":"production"`, `problems: []`.
- **Webhook:** registered at `https://app.stellreducation.org/api/webhooks/background` with the related object included.
- **First real order:** placed 24 Sept at 20:39:33Z on a live mentor account with no licence state. The row went to `invited` with the candidate, invitation and form URL saved. Checkr production accepts a country-only work location.
- **Sync:** at about 20:45Z it returned `1 open — 0 updated, 1 unchanged`, so the production key and URL reach Checkr.

Staging stays on `stellr-web-dev`, unchanged.

## Open — in priority order

1. **Finish the first order (9.8).** When the candidate submits Checkr's form:
   - Her row should move to `in_progress` via the **webhook**. Prove this from `updated_at` with no Sync press in between; it is the first delivery signed with the production key.
   - Then check the final status, that "View report in Checkr" opens `dashboard.checkr.com`, and that the invitation came from a `checkr.com` sender.
   - Tick 9.8 with that evidence.
   - If the row doesn't move: check Checkr's webhook delivery log and the Vercel runtime logs for `/api/webhooks/background`. A 401 means the signature key doesn't match. Sync recovers the row in the meantime.
   - Read-only query on prod `hwtzpfrnksksxlwwabqz`: `select status, provider_report_ref, updated_at from member_background_checks order by created_at desc`.
2. **Package contents (9.19).** Basic Plus Criminal was chosen from general knowledge as the equivalent of `stellr_crimid`. Nobody has read its screenings in the production dashboard. Confirm them. Changing package means changing the slug and redeploying.
3. **First production cron with an open check (9.20).** Read the 25 Sept 06:30 UTC run of `/api/cron/background-sync`.
4. **Cosmetic, two small code items:**
   - The admin home panel labels the integration "checkr" in lowercase; the others have display names.
   - That panel keys off `isProductionDeployment()` rather than `isRealProductionApp()` (`app/(admin)/admin/page.tsx:28`), so it shows warnings on dev that shouldn't appear there.

Carried over, not from this session:
- 9.18: Tom Brady's staging invitation should expire around 29 Sept. Don't delete his row.
- B2: `expires_at` precedence.
- The dev seed cleanup waits on 9.18.

## Traps

- **`vercel env add` must run from the repo directory**, or with `--cwd`. From anywhere else it fails with "isn't linked".
- **Env vars need a redeploy.** Redeploy the current production deployment (`npx vercel redeploy <url> --target production --scope stellreducation`). `NEXT_PUBLIC_*` values are fixed at build time.
- **Vercel won't show most of these values back**, so read-back proves nothing. The proof is the health endpoint (base URL) and an accepted order (slug).
- **Checkr's production dashboard shows no webhook ID and has no send-test button.**
- **A 401 from a forged POST to the webhook proves nothing.** The endpoint also returns 401 when no secret is set.
- **e2e runs against the shared dev database.** On 24 Sept a slow credentials test left `STL-2026-E2EGRACE` public and failed every run after it. It was reset by hand; #176 made the test restore its own state.
- **Local checkout:** the main checkout at `stellr-web` holds uncommitted member-invite files from another session, so `git pull` refuses. Work in a worktree from `origin/dev`.

## Rollback

Remove `CHECKR_API_KEY` from `stellr-web` Production and redeploy. Checkr then reads `unconfigured` and orders are refused cleanly. Also disable the webhook in Checkr.
