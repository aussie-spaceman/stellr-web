# node-forge 1.4.3 bump — 2026-11-11

Slug: `node-forge-bump`. Handover: `HANDOVER-node-forge-bump-2026-11-11.md`. Doc snapshot: `1qB8-auNHsz4znkBQig7UZxXQEVhlxL-czei4aBvBOxg`.
PR #616 → `dev` as `65418f18`; not yet promoted (a separate session is promoting). Migration: none.

`node-forge` moved from 1.4.2 to 1.4.3 (range `^1.4.3`) to clear four 10 Nov advisories. `osv-scanner` passes on `dev` again.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| node-forge-bump.1 | Bump node-forge to >=1.4.3 on `dev` | #616 squash-merged as `65418f18`; lockfile shows 1.4.3; osv-scanner, verify and e2e passed by step outcome | — | ☑ |
| node-forge-bump.2 | node-forge 1.4.3 in production | Not on `main` at close-out (11 Nov); a separate session is promoting | Confirm `65418f18` is an ancestor of `main` after that promotion | ☐ |
| node-forge-bump.3 | Remove this session's worktree | `.claude/worktrees/nervous-hellman-edabb9` kept; the merge ran from inside it | Next `npm run worktrees -- --apply` from the main checkout | ☐ |
