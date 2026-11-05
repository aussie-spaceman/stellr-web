# Slow e2e apt downloads: cause and cache — 2026-11-05

Slug: `e2e-apt-cache`. Handover: `HANDOVER-e2e-apt-cache-2026-11-05.md`. Doc snapshot: `1Htw94hyYiU45y-2En4nl6ACUVnb1NmBw_Lz1jNfTc_g`.
#525 → `dev` as `0106e78f`; not promoted by this session. This session's #524 closed unmerged. Migration: none.

Found why `playwright install-deps` sometimes takes 10 minutes: a slow Ubuntu mirror. The fix, a `.deb` cache in `.github/actions/playwright-browsers`, landed inside #525, and the cache is seeded on `dev`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| e2e-apt-cache.1 | Cause of slow `install-deps` | Identified from job logs: apt's 114 MB download sometimes runs at about 200 kB/s for a whole job. 4 of 154 runs from 12 Oct to 4 Nov took over 8 minutes, and 2 hit the 20-minute limit. Why the mirror slows is not visible from our side | None | ☑ |
| e2e-apt-cache.2 | Cache restore works | Proven on #525's run 41968744860, `storybook`: `Cache hit for: playwright-apt-Linux-ubuntu24-1.64.1-chromium-2026-W45`, `Need to get 0 B/21.1 MB of archives` | None | ☑ |
| e2e-apt-cache.3 | `dev` holds the caches | Manual run 42030301231 logged `Cache saved with key:` for both W45 keys, and the caches API lists them on `refs/heads/dev` (114 MB, 21 MB) | None | ☑ |
| e2e-apt-cache.4 | Another PR restores from `dev`'s cache | Not seen. The runs since seeding were cancelled, skipped the suite or were still in progress at close-out. A WebKit hit has never been observed; only the chromium key has hit | Read the next passed PR `e2e-tests` log for a cache hit and `Need to get 0 B/114 MB` or close to it | ☐ |
| e2e-apt-cache.5 | Owner review of #525 | Merged on the owner's instruction to proceed. #525 touches CODEOWNERS files and GitHub records no review. This session did not read the whole diff | Owner reads the #525 diff before promoting | ☐ |
| e2e-apt-cache.6 | Flaky survey test | `e2e/core/survey.spec.ts:243` failed once and passed on retry in run 42030301231. Cause not investigated | Investigate if it recurs | ☐ |
| e2e-apt-cache.7 | Leftover branch and worktree | `fix/e2e-apt-deb-cache` deleted locally and on GitHub. The worktree `.claude/worktrees/e2e-apt-deb-cache` holds this close-out until it merges | Confirm it is gone with `npm run worktrees` | ☐ |
