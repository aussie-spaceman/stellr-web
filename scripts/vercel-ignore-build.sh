#!/usr/bin/env bash
# Vercel Ignored Build Step, wired in by `ignoreCommand` in vercel.json.
#
# Exit 0 = skip this deployment. Exit 1 = build it. (Vercel's convention; yes,
# it is backwards from a test.)
#
# Both Vercel projects are linked to this one repo, and until 15 Sept 2026 every
# push to every branch built a deployment in BOTH — six deployments per PR, none
# of the previews used. Function Storage is metered on retained deployments and
# reached 75% of the Hobby limit. The rule is now:
#
#   stellr-web      (production)  builds `main` only
#   stellr-web-dev  (dev)         builds `dev`  only
#
# This script cancels a build; it does NOT stop the deployment being created,
# and a CANCELED deployment still counts toward the Hobby deployments/day limit
# (100). On 28 Sept 2026, 100 deployments in 4.4 hours hit the limit and 75 of
# them were cancelled here. So `vercel.json` also sets `git.deploymentEnabled`:
# only `main` and `dev` create deployments at all (a branch deploys if any
# matching pattern is true, so `"**": false` plus two `true`s). Feature-branch
# pushes now cost nothing. This script still matters for the two branches that
# do deploy: every `dev` push reaches the production project too, and every
# `main` push reaches the dev project, and one of each pair must be skipped.
#
# On the dev project, a `dev` push that changes only docs is skipped too (see
# below).
#
# Anything unrecognised builds, and says why, so a misconfiguration shows up as
# a stray deployment in the dashboard rather than as silence. Project IDs are in
# docs/ENV-MATRIX.md.

PROD_PROJECT_ID="prj_wMlZwzDocSUrQ5sFZMngrNBeoUvx"
DEV_PROJECT_ID="prj_Nd2kmpMj3bBuXbSjc6teUdwh9gPO"

ref="${VERCEL_GIT_COMMIT_REF:-}"
project="${VERCEL_PROJECT_ID:-}"

case "$project" in
  "$PROD_PROJECT_ID") wanted="main" ;;
  "$DEV_PROJECT_ID")  wanted="dev" ;;
  *)
    echo "vercel-ignore-build: unknown VERCEL_PROJECT_ID '${project}' — building"
    exit 1 ;;
esac

if [ -z "$ref" ]; then
  echo "vercel-ignore-build: VERCEL_GIT_COMMIT_REF is empty — building"
  exit 1
fi

if [ "$ref" != "$wanted" ]; then
  echo "vercel-ignore-build: this project builds '${wanted}' only; '${ref}' skipped"
  exit 0
fi

# Docs-only `dev` pushes are skipped on the dev project (6 Oct 2026). Every
# retained build holds ~42 MB of functions, and builds are kept for days, so they
# fill Hobby's 10 GB Function Storage. On 6 Oct the dev project held 146 builds
# and 82 of them changed nothing but docs: close-outs, handovers and promotion
# records. The rule matches CI's `changes` job (.github/workflows/ci.yml):
# `docs/`, `.claude/`, root `*.md`. Nothing at runtime reads those paths.
#
# Production is deliberately left out. A docs-only push to `main` is how a
# missing production deployment gets re-triggered (#197, 24 Sept).
#
# VERCEL_GIT_PREVIOUS_SHA is the last *successful* deployment on this branch.
# Skipped builds don't count as successful, so the diff covers every change since
# the last real build. If that commit is missing from Vercel's shallow clone, or
# anything else fails to resolve, the build goes ahead. Put `[build]` in the
# commit message to force a build.
if [ "$project" = "$DEV_PROJECT_ID" ]; then
  prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
  case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
    *"[build]"*)
      echo "vercel-ignore-build: [build] in the commit message — building"
      exit 1 ;;
  esac
  if [ -n "$prev" ] && git cat-file -e "${prev}^{commit}" 2>/dev/null \
     && files=$(git diff --name-only --no-renames "$prev" HEAD 2>/dev/null) \
     && [ -n "$files" ] \
     && ! printf '%s\n' "$files" | grep -qvE '^(docs/|\.claude/)|^[^/]+\.md$'; then
    echo "vercel-ignore-build: docs-only change since ${prev:0:7} — skipped"
    printf '%s\n' "$files" | sed 's/^/  /'
    exit 0
  fi
fi

echo "vercel-ignore-build: ${ref} on this project — building"
exit 1
