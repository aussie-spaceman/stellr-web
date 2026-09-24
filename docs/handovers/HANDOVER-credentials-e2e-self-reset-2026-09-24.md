# Handover: credentials e2e self-reset (24 Sept 2026)

Tracker: `docs/handovers/TRACKER.md` → Session 13. Doc snapshot:
`1b3z7Nnr6jVvCVFsbg7fhEyKdQPO6IpY1HKXBQTh0OGw`.

## What happened
On 24 Sept, in #175's run 36031226967 (attempt 1), `e2e/core/credentials.spec.ts` › "she can make it
public…" clicked **Make public**, and the DB updated at 17:06:46Z. But **Make private** did not appear
within the default 5s expect timeout. The test failed before its in-test cleanup, so
`STL-2026-E2EGRACE` stayed `public` on the dev Supabase project (`xvxlhbxtiwxpopoqjygm`). Every
retry and later run then failed at the first `Make public` assertion. It was reset by hand. That run
now shows success on attempt 3, so the failure only appears in attempts 1–2.

## What landed (#176 → `dev` as `ff39554`; test-only)
- The publish test sits in a nested `describe('publishing')` with a `beforeEach` and an `afterEach`.
  Each one POSTs `{ visibility: 'private' }` to `/api/credentials/STL-2026-E2EGRACE/visibility`
  as Grace (teacher storage state) and asserts a 200.
- The reset uses the owner's own API rather than a service-role client, so it also works against an
  `E2E_BASE_URL` target without a local service key.
- The hooks cover only that test. The suite is `fullyParallel`, and a reset on the wallet test could
  flip the credential partway through this one.
- Both assertions after the toggle now wait 20s (`AFTER_TOGGLE`). What they assert is unchanged.

**Evidence:** the Playwright step passed on the PR (run 36034777152: 56 passed, 1 skipped; the skip is
the smoke test that needs `E2E_BASE_URL`, and no test was flaky) and on dev's post-merge run
(36035688585, on `ff39554`). A read-only SQL query on dev showed Grace `private`, updated
17:45:23Z.

## Open (see TRACKER 13.1–13.4)
1. **Separate runs share one fixture (medium).** `ci.yml` groups runs by `ci-${{ github.ref }}`,
   so runs from different refs overlap on the shared dev DB (today: the fix branch at 17:30 and
   dev at 17:33). With the new hooks, one run's reset can flip Grace private halfway through
   another run's publish test. That fails loudly now, instead of poisoning the database, but it
   is still a flake. Fix: a repo-wide concurrency group on the `e2e` job
   (`group: e2e-dev-supabase`, `cancel-in-progress: false`), or a credential per run.
2. **Cause of the slow re-render is reasoned, not measured.** `components/credentials/CredentialActions.tsx`
   POSTs and then calls `router.refresh()`, and the label changes only when the server page has
   re-rendered. If a 20s timeout still fails, open attempt 1's video and trace and time that
   render.
3. **The afterEach reset has never run after a real failure.** Playwright guarantees afterEach
   hooks run on failure. Optional proof: a local run with a temporary throw after "Make public",
   then read the row.
4. The squash-merged branch `fix/credentials-e2e-self-reset` is still checked out in this session's
   worktree. Archive the session. Don't commit to that branch again.

## Ship-skill steps skipped
The Phase 1 checklist confirmation (per "ship means proceed"), the Phase 4 review table, `/code-review`,
and a local run (this worktree has no `.env.local`, and some local env files point at production).
The CI e2e job was the only run.
