#!/usr/bin/env bash
# Real concurrency against rate_limit_take, for the `db` job in ci.yml only.
#
# It sits outside pgTAP because one transaction cannot race itself, and dblink
# refuses a non-superuser's connection when the local database trusts it without
# using the password. These sessions commit. Their keys are random and the CI
# database is thrown away, so never point this at a database you keep.
#
# Usage: scripts/ci-rate-limit-race.sh <db-container>
set -euo pipefail

container="${1:?usage: ci-rate-limit-race.sh <db-container>}"

sql() {
  docker exec -i -e PGPASSWORD=postgres "$container" \
    psql -h 127.0.0.1 -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"
}

one="$(openssl rand -hex 32)"
two="$(openssl rand -hex 32)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pids=()

# Sessions 1 to 8 race on one key, with a limit of 5.
for i in 1 2 3 4 5 6 7 8; do
  sql "SELECT allowed FROM public.rate_limit_take(ARRAY[decode('$one', 'hex')], ARRAY[5], ARRAY[60])" \
    > "$work/one.$i" 2>&1 &
  pids+=("$!")
done

# Sessions 9 to 16 list the same two keys in opposite orders, the deadlock shape.
for i in 9 10 11 12 13 14 15 16; do
  if [ $((i % 2)) -eq 0 ]; then first="$one"; second="$two"; else first="$two"; second="$one"; fi
  sql "SELECT allowed FROM public.rate_limit_take(ARRAY[decode('$first', 'hex'), decode('$second', 'hex')], ARRAY[100, 100], ARRAY[120, 120])" \
    > "$work/two.$i" 2>&1 &
  pids+=("$!")
done

failed=0
for pid in "${pids[@]}"; do
  wait "$pid" || failed=$((failed + 1))
done
if [ "$failed" -ne 0 ]; then
  echo "::error::$failed of 16 concurrent takes failed; a deadlock or a lock timeout shows below."
  cat "$work"/* >&2
  exit 1
fi

check() {
  if [ "$2" != "$3" ]; then
    echo "::error::$1: expected $3, got $2"
    exit 1
  fi
  echo "ok: $1 ($2)"
}

allowed="$(cat "$work"/one.* | grep -c '^t$' || true)"
check 'eight concurrent takes against a limit of 5 allow exactly 5' "$allowed" 5

hits="$(sql "SELECT hits FROM public.rate_limit_hits WHERE key_hash = decode('$one', 'hex') AND window_seconds = 60")"
check 'and lose no count' "$hits" 8

both="$(sql "SELECT sum(hits)::int FROM public.rate_limit_hits WHERE key_hash IN (decode('$one', 'hex'), decode('$two', 'hex')) AND window_seconds = 120")"
check 'opposite-order takes on two keys all finish, with no deadlock' "$both" 16
