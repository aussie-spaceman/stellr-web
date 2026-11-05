# Handover: slow e2e apt downloads — 2026-11-05

Tracker: `tracker/2026-11-05-e2e-apt-cache.md`. Related: `HANDOVER-e2e-speedups-2026-11-05.md`, the session that owned #525.

This session did not ship a PR of its own. Its #524 was closed unmerged because #525 carried the same cache design. It merged #525 on the owner's instruction, and promotion is left to a separate session.

## The problem

`npx playwright install-deps chromium webkit` in the e2e job usually takes about 30 s, but took 569 s in run 41868376695 and 631 s in run 41908699558 on 4 Nov.

## The cause

The time goes on apt downloading 114 MB of `.deb` files from `azure.archive.ubuntu.com`, which sometimes runs at about 200 kB/s for a whole job (`Fetched 114 MB in 9min 9s (208 kB/s)`, against 8-29 MB/s normally).

- It is not the runner's network. The same slow jobs restored GitHub's cache at 81-213 MB/s.
- It is not a mirror-wide outage. Neighbouring runs were fast.
- Nothing fails over. The runner image moves to its next mirror only on a stall, so a slow connection that keeps moving never does.

Across 154 runs from 12 Oct to 4 Nov, 139 took under 60 s, 9 took 60-120 s, and 6 took 120 s or more. Four took over 8 minutes, and two of those (39832574083, 41918373322) hit the 20-minute limit before any test ran.

Why the mirror slows is not visible from our side.

## What changed

`.github/actions/playwright-browsers/action.yml`, from #525, keeps apt's packages in GitHub's cache under a weekly key seeded from the previous week. apt checks each restored file against its signed index. The install step also has a 3-minute timeout and one retry, tracked as `e2e-speedups.5`.

## How the cache reaches a PR

- GitHub shares a cache saved on `refs/pull/N/merge` only with that PR. Other PRs read from the base branch, so `dev` has to hold the cache.
- #525 also skips the suite on a push whose exact tree already passed, so the push that merges a PR often saves nothing. A push with a new tree does run the suite and save.
- Run 42030301231, started manually, seeded `dev` for week W45 for this reason. Next week's key restores from this one through `restore-keys`.
- Once the nightly in `e2e-nightly.yml` is running, it should keep `dev` populated too. It can only start once this reaches `main`.

## Not verified

- No other PR has been seen restoring from `dev`'s cache (`.4`). Only the chromium key has ever hit, on #525's own re-run. The 114 MB WebKit key has never been restored.
- The fix has not met a slow mirror. A run with no usable cache can still take as long as the mirror does, limited by the retry and then the 20-minute job limit.

## Worth knowing

- The owner's instruction to proceed is the only approval on #525 (`.5`). This session read its description and the apt section of the action, not the whole diff, and did not check how its lock changes affect the `e2e-dev-supabase` constraint in the original brief.
- #541, open at close-out, changes how e2e jobs queue behind the lock. Until it lands, a third queued run still cancels the waiting one.
- `osv-scanner` was red on #525 from three medium npm advisories unrelated to this work. It is not a required check on `dev`.
