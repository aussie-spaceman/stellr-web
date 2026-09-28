# Concurrent close-outs + Vercel deployment volume — 2026-09-28

Slug: `concurrency-deploy-volume`. Handover: `HANDOVER-concurrency-deploy-volume-2026-09-28.md`. Doc snapshot: `1UQn1HejXNjr1kFzPxtL1uG0Un3yLxTiKFFpRB_Evq64`.
PRs: #237 → `dev` as `90a9ee5`; #239 → `dev` as `b54c0a1`. Not promoted, and neither needs production. Migration: none.

Close-outs no longer collide: each session has its own tracker file, and docs-only changes skip e2e. Vercel deployments are only created for `main` and `dev`, and a promotion now makes one record merge instead of 2–3 record PRs plus a sync.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| concurrency-deploy-volume.1 | Docs-only push to `dev` skips e2e | Unproven. Only the PR path has been seen (#238). The push path diffs `github.event.before..sha`. | Read the `dev` push run for this close-out's merge commit: `changes` shows `code=false` and `e2e` shows skipped. | ☐ |
| concurrency-deploy-volume.2 | New promote Step 1 and Step 8 unexercised | Skill text only (#239). Step 8's record PR must merge with `--merge`, not squash. It should also remove the cause of TRACKER 20.3, since `dev` no longer lands on `main`'s SHA; 20.3 stays open until this is seen. | At the next `/promote`, check that `dev` contains `main`'s merge commit afterwards (`git merge-base --is-ancestor <merge-sha> origin/dev`), and that the next promotion PR does not open `BEHIND`. | ☐ |
| concurrency-deploy-volume.3 | Deployment volume after fixes 1–3 | 28 Sept baseline: 100 in 4.4 h (75 CANCELED). Estimated ~33–37 on a similar day now. | After a busy week, count with Vercel MCP `list_deployments` (slug `stellreducation`, both project IDs, `since` = 24 h ago). If a normal day is over ~70, take the fix-4 decision in `docs/REC-vercel-deployment-volume-2026-09-28.md`. | ☐ |
| concurrency-deploy-volume.4 | Fix 4 (Pro or merge projects) not built | Asked for, but it is a billing or dashboard decision. Recommendation: neither yet; Pro before any project merge. | David: decide after row 3. | ☐ |
| concurrency-deploy-volume.5 | REC claims not re-checked against Vercel docs | Pro's deployments/day figure, crons running only on production deployments, Custom Environments being Pro-only. | Check vercel.com/docs → Limits before acting on row 4; correct the REC if wrong. | ☐ |
| concurrency-deploy-volume.6 | Sessions may still use the global close-out | `/anthropic-skills:close-out` still exists and knows nothing of `tracker/`. Worktrees made before #237 lack `/close-out`. | In any older worktree, `git merge origin/dev` before closing out. Watch the next few close-out PRs for edits to `TRACKER.md`. | ☐ |
| concurrency-deploy-volume.7 | Two tracker files merged back to back | Not tested; expected to be fine (new files, `dev` `strict: false`). | The next pair of concurrent close-outs proves it; the second PR should stay `MERGEABLE`. | ☐ |
| concurrency-deploy-volume.8 | Main checkout stale | Fixed: fast-forwarded `75f03d2` → `b54c0a1`, tree clean. | — | ☑ |
| concurrency-deploy-volume.9 | #235 blocked (DIRTY and cancelled e2e) | Merged by its own session (`819ce5d`). | — | ☑ |

