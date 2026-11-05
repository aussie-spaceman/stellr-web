#!/usr/bin/env bash
# Builds the disposable e2e database inside a running local Supabase stack: the
# schema of record, every migration since it, then the fixtures. Same load as the
# `db` job in .github/workflows/ci.yml; docs/RUNBOOK-ci-database.md explains it.
#
# Destroys the public schema of the database it is given, so it talks only to the
# local container by name and takes no connection string.
set -euo pipefail

container="${DB_CONTAINER:-supabase_db_stellr-web}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

psql_local() {
  docker exec -i -e PGPASSWORD=postgres "$container" \
    psql -h 127.0.0.1 -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
}

# See the `db` job for why these three kinds of line are dropped.
sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' \
    -e '/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin /d' \
    supabase/baseline.sql > "$tmp"
psql_local -c 'drop schema if exists entitlements cascade' -c 'drop schema public cascade' -f - < "$tmp"

count=0
for f in $(ls supabase/migrations | grep -E '^[0-9]{14}_.+\.sql$' | sort); do
  psql_local --single-transaction -f - < "supabase/migrations/$f"
  count=$((count + 1))
done
echo "Applied $count migrations on top of the baseline."

psql_local -f - < supabase/seed.sql
psql_local -f - < supabase/seed-e2e-stack.sql

# Exposed here, as on the hosted projects (migration 090), and not in config.toml:
# PostgREST reports unhealthy if a schema it is told to serve doesn't exist yet,
# and `supabase start` stops the whole stack before this script can create it.
psql_local -c "alter role authenticator set pgrst.db_schemas = 'public, graphql_public, entitlements'"

# PostgREST started before these schemas existed.
psql_local -c "notify pgrst, 'reload config'" -c "notify pgrst, 'reload schema'"
