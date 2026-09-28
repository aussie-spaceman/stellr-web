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

if [ "$ref" = "$wanted" ]; then
  echo "vercel-ignore-build: ${ref} on this project — building"
  exit 1
fi

echo "vercel-ignore-build: this project builds '${wanted}' only; '${ref}' skipped"
exit 0
