#!/usr/bin/env bash
# overlay-critical.sh — replace the critical tables in a database restored from
# a nightly backup with the newer rows in an hourly backup.
#
#   ops/backups/overlay-critical.sh --dbname "$OWNER_DB_URL" --dump critical.dump --tables manifest.tsv
#   ops/backups/overlay-critical.sh --print-sql --tables manifest.tsv     # print the script; connect to nothing
#
# Used by docs/RUNBOOK-backups.md §6 step 3 (full recovery) and by
# restore-drill.sh, so every drill exercises the recovery step itself.
#
# --tables   the hourly archive's manifest.tsv (first column: schema.table) —
#            exactly the tables the hourly holds
# --dump     the hourly archive's critical.dump
# --dbname   a database already restored from a nightly (libpq URI or name)
# --fail-on-orphans   roll back if any foreign-key orphans are found
# --dry-run  do everything, report, then roll back
#
# Why DELETE and not TRUNCATE: other tables (chat_messages, community_posts,
# cohort_members, coaching_requests, entitlements.offerings, …) have foreign
# keys to members, participants and registrations. Postgres refuses to
# TRUNCATE a table that another table references, and session_replication_role
# does not lift that check; TRUNCATE … CASCADE would empty those other tables,
# which were just restored from the nightly. Foreign keys are enforced by
# triggers, and under session_replication_role = replica ordinary triggers do
# not fire, so DELETE neither refuses nor cascades.
#
# Everything runs in ONE transaction: delete every listed table's rows, load
# the hourly's rows (COPY, and the sequence values the dump holds), then count
# foreign-key orphans in both directions — rows anywhere that point at a
# critical row the hourly no longer has (deleted after the nightly), and
# critical rows that point at a row the nightly does not have yet. The report
# names the constraint and the count, never a value. Orphans are expected when
# rows changed between the nightly and the hourly; resolve them with the owner
# before reopening (normally: delete the orphaned child rows, as the cascade
# would have).
#
# Needs a role that may set session_replication_role (a superuser on a scratch
# server; `postgres` on Supabase is to be confirmed in a drill against a
# scratch Supabase project before it is needed for real).
set -euo pipefail
export LC_ALL=C
export PGTZ=UTC

dbname="" dump="" tables="" print_sql=0 fail_on_orphans=false dry_run=false
while [ $# -gt 0 ]; do
  case "$1" in
    --dbname) dbname="$2"; shift 2 ;;
    --dump) dump="$2"; shift 2 ;;
    --tables) tables="$2"; shift 2 ;;
    --print-sql) print_sql=1; shift ;;
    --fail-on-orphans) fail_on_orphans=true; shift ;;
    --dry-run) dry_run=true; shift ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
    *) echo "overlay: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$tables" ] && [ -f "$tables" ] || { echo "overlay: --tables <manifest.tsv> is required" >&2; exit 2; }

list=()
while IFS=$'\t' read -r t _; do
  [ -n "$t" ] || continue
  # Names go into SQL unquoted; allow only plain schema.table.
  [[ "$t" =~ ^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$ ]] || { echo "overlay: refusing table name '$t'" >&2; exit 2; }
  list+=("$t")
done < "$tables"
[ ${#list[@]} -gt 0 ] || { echo "overlay: $tables lists no tables" >&2; exit 2; }

# The wrapper script. $1 is the data file psql includes (pg_restore output).
wrapper_sql() {
  local data="$1" t quoted=""
  for t in "${list[@]}"; do quoted+="${quoted:+, }'$t'"; done
  echo '\set ON_ERROR_STOP 1'
  echo 'BEGIN;'
  echo 'SET LOCAL session_replication_role = replica;'
  for t in "${list[@]}"; do echo "DELETE FROM $t;"; done
  echo "\\i $data"
  echo 'SET LOCAL session_replication_role = origin;'
  # With only pg_catalog on the path, regclass prints schema.table, which is
  # what crit holds.
  echo 'SET LOCAL search_path = pg_catalog;'
  cat <<SQL
DO \$orphans\$
DECLARE
  crit text[] := ARRAY[$quoted];
  r record;
  n bigint;
  total bigint := 0;
BEGIN
  FOR r IN
    SELECT con.conname, con.conrelid::regclass AS child, con.confrelid::regclass AS parent,
           a.attname AS child_col, af.attname AS parent_col,
           pg_catalog.array_length(con.conkey, 1) AS nkeys
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_attribute a  ON a.attrelid = con.conrelid  AND a.attnum = con.conkey[1]
      JOIN pg_catalog.pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = con.confkey[1]
     WHERE con.contype = 'f'
       AND (con.conrelid::regclass::text = ANY (crit) OR con.confrelid::regclass::text = ANY (crit))
  LOOP
    IF r.nkeys > 1 THEN
      RAISE WARNING 'orphans: % on % has a multi-column key; check it by hand', r.conname, r.child;
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %s c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE p.%I = c.%I)',
                   r.child, r.child_col, r.parent, r.parent_col, r.child_col) INTO n;
    IF n > 0 THEN
      RAISE WARNING 'orphans: % row(s) of % point at missing % rows (constraint %)', n, r.child, r.parent, r.conname;
      total := total + n;
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('stellr.overlay_orphans', total::text, true);
END
\$orphans\$;
SQL
  echo "SELECT pg_catalog.current_setting('stellr.overlay_orphans')::bigint AS orphans \\gset"
  echo "\\echo 'overlay: ${#list[@]} tables replaced; foreign-key orphans:' :orphans"
  echo "SELECT (:orphans > 0 AND $fail_on_orphans) OR $dry_run AS roll_back \\gset"
  echo '\if :roll_back'
  echo "  \\echo 'overlay: rolled back (--dry-run, or orphans with --fail-on-orphans)'"
  echo '  ROLLBACK;'
  echo '\else'
  echo '  COMMIT;'
  echo '\endif'
}

if [ "$print_sql" -eq 1 ]; then
  wrapper_sql "<pg_restore --data-only output>"
  exit 0
fi

[ -n "$dbname" ] || { echo "overlay: --dbname is required" >&2; exit 2; }
[ -n "$dump" ] && [ -f "$dump" ] || { echo "overlay: --dump <critical.dump> is required" >&2; exit 2; }

work="$(mktemp -d "${TMPDIR:-/tmp}/overlay.XXXXXX")"
trap 'rm -rf "$work"' EXIT
# The hourly's rows as a SQL script (COPY blocks, setval for owned sequences).
pg_restore --data-only --no-owner --file="$work/data.sql" "$dump"
wrapper_sql "$work/data.sql" > "$work/overlay.psql"
# VERBOSITY=terse: an error names the table and constraint, not the row.
psql "$dbname" -X -q -v VERBOSITY=terse -v SHOW_CONTEXT=never -f "$work/overlay.psql"
