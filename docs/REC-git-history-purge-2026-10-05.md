# REC: purge the old testimonial videos from git history?

**For:** David · **Written:** 5 Oct 2026 · **Status:** decision open, nothing done

## Recommendation

**Don't purge now.** The cost that prompted this, CI timing out on a 1 GB
checkout, is fixed without rewriting history: #286 (e29b687 on `dev`) makes
the `changes` job check out blobless. A purge would still be worth doing at some point, but
it's a one-time cleanup with a long tail, and nothing currently depends on it.
If you want it done, do it in a quiet window using the checklist below, not
during an event week.

## The numbers (5 Oct)

| | |
|---|---|
| Pack size (local `size-pack`; GitHub reports `size` 1,039,317 KB) | 1,017 MiB |
| Of which `public/videos/**` blobs | ~954 MB (~90 %) |
| Largest single blob | `testimonial-tom-wilson.mp4`, 74 MB |
| When they were added / removed | 29 Jun – 2 Jul 2026 / 21 Sept (#129, moved to Vercel Blob) |
| Current tree (`dev`) | ~15 MB |
| Blobless clone of full history | 1.5 MB, ~1 s |
| Full clone | 237 s |

`public/files/*.pdf` and `public/student-work/*` also moved in #129 and add a
few tens of MB. They're not worth a separate decision.

## What still pays for the history after #286

- **CI:** nothing. `verify` and `e2e` use `fetch-depth: 1`, which fetches the
  current tree only. `changes` is blobless.
- **Vercel:** nothing. Its git clone is shallow.
- **Local:** a fresh clone takes about 4 min, once per machine. Worktrees share
  the main checkout's object store, so a new worktree costs nothing. A fresh
  machine can use `git clone --filter=blob:none` and fetch blobs only as
  checkouts need them.

## What a purge costs

`git filter-repo --path public/videos --invert-paths` (plus any other paths)
rewrites **every commit from 29 Jun onward**, which is almost the whole repo.
Every SHA after that changes. In this repo that matters more than usual:

1. **SHA references in the docs.** `docs/` and `.claude/` cite 271 distinct
   commit SHAs that resolve today. They include the 34 promotion records in
   `.claude/releases/`, which give the **rollback target** for each production
   release. After a rewrite, none of them resolve. They would need a
   translation table (filter-repo writes `.git/filter-repo/commit-map`),
   committed alongside the change, or a scripted rewrite of the docs.
2. **Every clone and worktree must be re-cloned, not pulled.** The main
   checkout has 8 worktrees. A pull from an old clone re-merges the old
   history and brings the blobs back. Each worktree holds a `.env.local`,
   and some have held production keys. Copy
   those files out before deleting anything.
3. **Open PRs and unmerged branches** must be landed or recreated first. Their
   bases no longer exist after the rewrite. Check `gh pr list --state open`
   on the day.
4. **Branch protection.** `main` and `dev` are protected and admin-enforced,
   so the force-push needs protection lifted briefly by an admin, then restored
   with the same required checks (`verify`, `e2e`) and settings.
5. **GitHub keeps the old objects anyway** until its own GC. `refs/pull/*/head`
   is read-only and keeps every old PR commit reachable. The repo's reported
   size won't fall until GitHub Support runs a GC on request. A plain clone
   doesn't fetch `refs/pull/*`, so new clones shrink at once; the server-side
   number doesn't.
6. **Vercel.** Existing deployments keep their SHAs, and the dashboard's commit
   links to old deployments break. That's cosmetic. Rollback by redeploying a
   Vercel deployment still works. Rollback by SHA (`git revert` / checkout of a
   recorded target) needs the commit map.
7. **Supabase migration ledger** isn't affected. It's keyed by filename
   timestamp, not by commit.

## If you decide to do it — checklist

1. Pick a window with no event in the following 48 h and no other sessions
   running.
2. Land or close every open PR. Run `git worktree list` and delete every
   worktree except the main checkout, keeping copies of their `.env.local`.
3. Make a mirror backup: `git clone --mirror git@github.com:aussie-spaceman/stellr-web.git stellr-web-backup.git`.
4. In a fresh mirror clone, run
   `git filter-repo --path public/videos --invert-paths` (optionally add
   `--path public/files --path public/student-work`, checked against the
   current tree first so nothing live is removed).
5. Commit `docs/archive/history-rewrite-commit-map-<date>.txt` from
   `.git/filter-repo/commit-map`, so every old SHA cited in `docs/` and
   `.claude/releases/` can still be looked up.
6. Temporarily allow force-push on `main` and `dev`, push `--force --all` and
   `--tags`, and restore protection exactly. Then check the required checks
   are still `verify` and `e2e`.
7. Open a GitHub Support request to GC the repository.
8. Re-clone the main checkout. Every session starts a fresh worktree from it.
9. Confirm the next `dev` push and promotion deploy normally (a merge isn't a
   deployment; check `list_deployments` by SHA).

## What would change this recommendation

- The pack keeps growing from new binary commits. The fix for that is a
  pre-commit or CI size guard, not a purge.
- A new contributor or machine has to clone regularly, so 4 minutes becomes a
  repeated cost.
- Another job needs `fetch-depth: 0` with blobs, such as a changelog or blame
  tool.
