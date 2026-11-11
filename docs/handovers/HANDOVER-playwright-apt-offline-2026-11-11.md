# Handover: browser libraries install offline from the apt cache — 11 Nov 2026

Tracker: `docs/handovers/tracker/2026-11-11-playwright-apt-offline.md`. PRs: #630 (`e5421e23`) and #631 (`48a7573d`), both on `dev`, neither promoted.

## Context

On 11 Nov runners could not resolve the Ubuntu mirrors for hours, and four jobs failed even when the apt cache from `e2e-apt-cache` (5 Nov) restored: `storybook`, `e2e-tests`, `e2e-local` and `tenant-host-routing`. There were two defects:

1. `playwright install-deps` always runs `apt-get update` first, so a restored deb cache did not help without the network.
2. The retry did nothing. `timeout` kills its own process group, but `sudo` starts apt-get in a session of its own. The stopped try's apt-get kept `/var/lib/apt/lists/lock`, and the next two tries failed at once with "Could not get lock".

## What changed (#630)

- New `.github/actions/playwright-browsers/install-deps.sh`, called from `action.yml`.
- **Retry:** after a stopped try, `sudo pkill -x apt-get` (TERM, then KILL). It waits for dpkg to finish rather than killing it, then runs `sudo dpkg --configure -a`.
- **Offline install:** after an online install, the action saves the package lists (`InRelease` plus the matching `Packages` files) into `~/apt-archives/lists`, beside the debs. Before using the saved lists, the script checks them:
  - each `InRelease` must pass `gpgv` against the Ubuntu archive keyring named by the image's own `ubuntu.sources`;
  - each `Packages` file must match the size and SHA256 in the signed text;
  - a list past its Valid-Until is refused;
  - a list both older than the image's own copy and over 14 days old is refused. The release pocket is frozen at release, so its old date is fine.

  It then runs `apt-get install --no-download` for the packages that `install-deps --dry-run` reports missing. apt still checks every deb's hash against those lists. There is no `--allow-unauthenticated` anywhere.
- **Order:**
  - exact hit: offline, then online;
  - an earlier week's entry: online once (the weekly refresh), then offline, then online;
  - no cache: online.
- The cache is saved only after an online install.
- The week key gained a `-lists` suffix. The restore-key prefix is unchanged, so old entries still restore, as `earlier`.

## Runner facts (Ubuntu 26.04)

- Sources use `mirror+file:/etc/apt/apt-mirrors.txt`, so list files are named `_etc_apt_apt-mirrors.txt_dists_<suite>_…`, and packages are `binary-amd64v3`.
- Lists are stored uncompressed. gpgv 2.4.8 is installed.
- Blocking all DNS for minutes makes the runner lose its own link to GitHub, and the job is cancelled with no log. In a test, restore DNS on a timer.

## Not verified

- The full week-turnover-during-an-outage path (row `.4`).
- That `dev`'s push run saves the `-lists` keys (row `.5`). Until it does, a PR's first run restores the old `dev` entry as `earlier` and goes online once.
- shellcheck (row `.8`).
- The owner has not reviewed #630, which touches CODEOWNERS paths (row `.6`).
- While writing this close-out, GitHub's job-log API returned 502. So whether #630's first CI attempt restored `dev`'s old entry was not read, and `e2e-apt-cache.4` stays open in that session's file.

## Side session

A side session ("Fix timing flake in esign tenant-sender test") opened #631. It froze the clock in a test that compared link expiries in seconds across a boundary, which had failed `unit` once on #630. The side session turned on auto-merge itself.
