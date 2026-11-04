#!/usr/bin/env sh
# Runs each Semgrep rule file's unit test: .semgrep/<name>.yml is tested
# against .semgrep/tests/<name>.<ts|tsx>, whose `// ruleid:` and `// ok:`
# annotations say which lines must and must not match. A rule file without a
# test fails, so a new rule cannot land untested.
#
# Usage: sh scripts/semgrep-rule-tests.sh   (needs `semgrep` on PATH; CI runs it
# inside the pinned Semgrep container, .github/workflows/security.yml)
set -eu

SEMGREP="${SEMGREP:-semgrep}"
status=0
found=0
for rule in .semgrep/*.yml; do
  name=$(basename "$rule" .yml)
  tests=$(ls .semgrep/tests/"$name".ts .semgrep/tests/"$name".tsx 2>/dev/null || true)
  if [ -z "$tests" ]; then
    echo "::error file=$rule::No rule test at .semgrep/tests/$name.ts(x)"
    status=1
    continue
  fi
  found=$((found + 1))
  echo "== $rule"
  # shellcheck disable=SC2086 # $tests is a list of paths without spaces
  if ! out=$("$SEMGREP" --test --metrics=off --config "$rule" $tests 2>&1); then
    status=1
  fi
  echo "$out" | grep -viE 'warn|^\s*$' || true
  # `semgrep --test` exits 0 when it found nothing to test; insist on a pass.
  echo "$out" | grep -q 'All tests passed' || status=1
done
[ "$found" -gt 0 ] || { echo "::error::No Semgrep rule tests ran."; status=1; }
exit "$status"
