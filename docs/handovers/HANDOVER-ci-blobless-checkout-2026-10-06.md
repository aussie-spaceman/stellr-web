# Handover: CI `changes` checkout and fail-closed e2e (5–6 Oct 2026)

Tracker: `tracker/2026-10-06-ci-blobless-checkout.md` (rows `ci-blobless-checkout.1–.6`).
PR #286 squash-merged to `dev` as `e29b687`. This is a CI-only change and was **not** in the
5–6 Oct promotion (#287), which carried #283 and #285.

## What went wrong

The `changes` job in `.github/workflows/ci.yml` decides whether `e2e` runs. It
checked out with `fetch-depth: 0`, which downloads the whole ~1 GB pack. About
954 MB of that is `public/videos/testimonial-*.mp4`, still in history although
the media moved to Vercel Blob on 21 Sept (#129). From ~16:19Z on 5 Oct the
checkout took 1.5–5+ min and three runs hit the 5-minute timeout. A cancelled
`changes` made `e2e` **skip**, and a skipped job satisfies the required `e2e`
check, so the PR still showed green.

The slowness was intermittent. Other runs that afternoon took 20 s. The large
pack made the job fragile; it wasn't permanently broken.

## What changed (#286)

1. `actions/checkout` in `changes` gets `filter: blob:none`. `fetch-depth: 0`
   stays, so every commit and tree is present and a push's `before` resolves
   exactly as before. Checkout now takes about 3 s; a blobless clone of the
   full history is about 1.5 MB.
2. Both diffs use `git diff --name-only --no-renames`. With rename detection,
   a rename lists only its new path, so `git mv app/x.md docs/x.md` used to
   read as docs-only (see 5c289e3, where the old migration filename was hidden).
   Without rename detection the diff also never needs a blob.
3. `e2e`'s `if` is now
   `!cancelled() && needs.verify.result == 'success' && needs.changes.outputs.code != 'false'`.
   Before, it ran only when `code == 'true'`, so any failure of `changes` meant
   a skip. Now only an explicit docs-only verdict skips e2e.

`verify` and `e2e` use the default `fetch-depth: 1`, the current tree only
(about 15 MB). They didn't need changing.

## How it was verified

- **Fail-closed:** a temporary `exit 1` in `changes` (run 37344939883) gave
  `changes` = failure, `verify` = success, and `e2e` started. The run was
  superseded in its build step, before Playwright touched the dev DB.
- **Code path:** run 37345644065. `changes` took 8 s, listed
  `.github/workflows/ci.yml`, and output `code=true`; `e2e` ran and passed.
- **Docs-only path:** this close-out PR is the first docs-only PR on the new
  workflow. Row `.1` records the result.

## Observed, not acted on

- On 5 Oct the superseded PR run (37344939883) was still `in_progress` ~15 s
  after the new push, with its `e2e` holding the repo-wide e2e lock. I
  cancelled it by hand so the waiting `dev` e2e for #283 wasn't displaced
  (GitHub keeps one pending job per group). On 6 Oct, dev run 37485928741 was
  cancelled 11 s after the e29b687 push run was created (15:20:45 →
  15:20:56Z). So workflow-level `cancel-in-progress` works but lags by
  seconds; the 5 Oct case was probably that lag. No action needed. Tracker
  row 13.5 is the separate issue that cancelling a running e2e mid-suite
  leaves rows mutated.
- `changes` isn't a required check. With the fail-closed `if`, it doesn't need
  to be: if it breaks, e2e runs.

## Open

See the tracker. The decision for David is `.5`, the history purge;
`docs/REC-git-history-purge-2026-10-05.md` recommends not doing it now and has
a checklist if he wants it anyway.
