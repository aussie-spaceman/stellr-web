#!/usr/bin/env bash
# Builds the schema of record in a running local Supabase database: the
# baseline, then every migration since it, oldest first, each in its own
# transaction. The same load as the `db` job in .github/workflows/ci.yml
# (docs/RUNBOOK-ci-database.md explains why each line is dropped), with no
# seed. Used by the tenant-db job.
#
# Destroys the public schema of the database it is given, so it talks only to
# the local container by name and takes no connection string.
#
# Usage: scripts/ci-db-build.sh [db-container]
set -euo pipefail

container="${1:-${DB_CONTAINER:-supabase_db_stellr-web}}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

psql_local() {
  docker exec -i -e PGPASSWORD=postgres "$container" \
    psql -h 127.0.0.1 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
}

sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    -e '/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin /d' \
    supabase/baseline.sql > "$tmp"
psql_local -c 'drop schema if exists entitlements cascade' -c 'drop schema public cascade' -f - < "$tmp"

count=0
for f in $(ls supabase/migrations | grep -E '^[0-9]{14}_.+\.sql$' | sort); do
  if ! psql_local --single-transaction -f - < "supabase/migrations/$f"; then
    echo "::error file=supabase/migrations/$f::This migration failed on a database built from the baseline."
    exit 1
  fi
  count=$((count + 1))
done
echo "Applied $count migrations on top of the baseline."
