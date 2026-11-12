# Browser libraries install offline from the apt cache — 2026-11-11

Slug: `playwright-apt-offline`. Handover: `HANDOVER-playwright-apt-offline-2026-11-11.md`. Doc snapshot: `1ff4SDM4QuxIOzN6Xiqv7FWCMqKoVil654XevBSkrmAM`.
#630 → `dev` as `e5421e23`; not promoted. #631 (side session) → `dev` as `48a7573d`; not promoted. Migration: none.

On 11 Nov the Ubuntu mirrors stopped resolving and every browser job failed, even with the apt cache restored. `.github/actions/playwright-browsers` now installs offline from the cache, using package lists checked against Ubuntu's signing key. A try that is stopped also stops its apt-get, so the retry no longer fails on the lists lock.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| playwright-apt-offline.1 | Retry stops the orphaned apt-get | Proven on throwaway run 43069548455, job `lock-kill`, with DNS blocked by iptables: apt-get stopped twice, no "Could not get lock", third try installed after DNS came back | None | ☑ |
| playwright-apt-offline.2 | Exact cache hit installs offline | PR #630 run 43074913323 attempt 3: `storybook` and `tenant-host-routing` installed 9 packages offline, `e2e-tests` and `e2e-local` 185, all `source=offline`, no `apt-get update` | None | ☑ |
| playwright-apt-offline.3 | Offline install works with the mirrors unreachable | Throwaway run 43073910536, job `exact-offline`, mirrors blackholed: 17 lists from 4 signed indexes loaded, 9 packages installed, Chromium launched | None | ☑ |
| playwright-apt-offline.4 | Week turnover during an outage (`earlier` restore → online fails → offline) | Throwaway job `outage-earlier`: the offline install succeeded with no lock errors, but the job skipped the browser download, so Chromium failed to launch. Not proven end to end | Read the log of the first real run that restores an earlier week's entry while the mirror fails | ☐ |
| playwright-apt-offline.5 | `dev` holds the new `-lists` caches | Push CI for `e5421e23` was queued at close-out. Nothing seen yet | In that run's `e2e-tests` log, find `Cache saved with key: playwright-apt-…-W46-lists` | ☐ |
| playwright-apt-offline.6 | Owner review of #630 | Merged on the owner's yes in chat. `.github/**` is in CODEOWNERS, and GitHub records no review | Owner reads the #630 diff before promoting | ☐ |
| playwright-apt-offline.7 | Promotion | `main` still runs the old action, so a mirror outage still fails browser jobs on promotion PRs | Ships with the next `promote` | ☐ |
| playwright-apt-offline.8 | Lint the new script | `install-deps.sh` passed `bash -n` only. shellcheck was not installed locally | Run `shellcheck .github/actions/playwright-browsers/install-deps.sh` | ☐ |
| playwright-apt-offline.9 | esign test flake (#631) | `lib/esign/tenant-sender.test.ts` froze the clock. The side session reported 50/50 local passes. #631 merged as `48a7573d` through auto-merge, which the side session turned on itself | None | ☑ |
| playwright-apt-offline.10 | Leftover branch and worktree | `ci/playwright-apt-offline` is gone from GitHub. The worktree `.claude/worktrees/nervous-hellman-edabb9` holds this close-out and cannot reach the main checkout | Run `npm run worktrees -- --apply` from the main checkout once this PR merges | ☐ |
