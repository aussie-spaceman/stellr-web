#!/usr/bin/env bash
# backup.sh — take one encrypted backup and upload it to Cloudflare R2.
#
#   ops/backups/backup.sh hourly    # critical tables (critical-tables.txt), schema + data
#   ops/backups/backup.sh nightly   # roles + full schema and data + storage metadata
#   ops/backups/backup.sh storage   # every file in every Supabase Storage bucket
#
# Runs from the PRIVATE backups repository's GitHub Action (workflow.yml in
# this folder); see docs/RUNBOOK-backups.md. It can also run on the owner's
# machine with the same environment variables.
#
# Every archive is a tar of the dump files plus manifest.tsv (fingerprint.sh:
# table, rows, SHA-256) and meta.json, encrypted with age to the owner-held
# public key(s) in AGE_RECIPIENT. The private key never reaches GitHub, so a
# compromised Action can write backups but never read one. R2 bucket lock
# rules (set by the owner) stop anything, including this job's own key, from
# deleting or overwriting an object before its retention ends.
#
# Environment:
#   PROD_DATABASE_URL     backup_reader role (read-only), session pooler URI
#   EXPECTED_PROJECT_REF  production project ref; the URL must contain it
#   AGE_RECIPIENT         one or more age public keys (age1…), space separated
#   R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
#   storage only: SUPABASE_S3_ENDPOINT SUPABASE_S3_REGION
#                 SUPABASE_S3_ACCESS_KEY_ID SUPABASE_S3_SECRET_ACCESS_KEY
set -euo pipefail
export LC_ALL=C
# timestamptz is printed in the session zone; fingerprints must not depend on it.
export PGTZ=UTC
# R2 rejects the newer default request checksums of some aws-cli versions.
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
kind="${1:-}"
case "$kind" in hourly|nightly|storage) ;; *) echo "usage: $0 hourly|nightly|storage" >&2; exit 2 ;; esac

die() { echo "backup: $*" >&2; exit 1; }
need() { for v in "$@"; do [ -n "${!v:-}" ] || die "$v is not set"; done; }
summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$*" >> "$GITHUB_STEP_SUMMARY"; fi; echo "$*"; }

need AGE_RECIPIENT R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

r2() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto \
    aws --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" "$@"
}

supa_s3() {
  AWS_ACCESS_KEY_ID="$SUPABASE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$SUPABASE_S3_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="$SUPABASE_S3_REGION" aws --endpoint-url "$SUPABASE_S3_ENDPOINT" "$@"
}

# Refuse anything but the read-only backup role on the production project:
# backing up the wrong database, or holding a write-capable URL in GitHub, are
# both failures worth stopping for.
check_database() {
  need PROD_DATABASE_URL EXPECTED_PROJECT_REF
  case "$PROD_DATABASE_URL" in *"$EXPECTED_PROJECT_REF"*) ;; *) die "PROD_DATABASE_URL does not name project $EXPECTED_PROJECT_REF" ;; esac
  local who
  who="$(psql "$PROD_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -F ' ' -c \
    "select current_user, current_setting('transaction_read_only'), r.rolsuper from pg_roles r where r.rolname = current_user")"
  read -r user ro super <<<"$who"
  [ "$user" != "postgres" ] || die "connected as postgres; use the read-only backup_reader role"
  [ "$super" = "f" ] || die "connected as a superuser; use the read-only backup_reader role"
  [ "$ro" = "on" ] || die "role $user is not read-only (default_transaction_read_only must be on)"
  echo "Database: project $EXPECTED_PROJECT_REF as $user (read-only)"
}

ts="$(date -u +%Y%m%dT%H%M%SZ)"
day_path="$(date -u +%Y/%m/%d)"
work="$(mktemp -d "${TMPDIR:-/tmp}/backup.XXXXXX")"
trap 'rm -rf "$work"' EXIT
stage="$work/stage"
mkdir -p "$stage"

write_meta() {
  local tables="$1" rows="$2"
  cat > "$stage/meta.json" <<JSON
{
  "kind": "$kind",
  "created_at": "$ts",
  "pg_dump": "$(pg_dump --version | tr -d '"')",
  "server_version": "${server_version:-n/a}",
  "tables": $tables,
  "rows": $rows,
  "source_commit": "${GITHUB_SHA:-local}"
}
JSON
}

encrypt_and_upload() {
  local key="$1" out="$work/archive.tar.age"
  local recipients=()
  for r in $AGE_RECIPIENT; do recipients+=(-r "$r"); done
  tar -C "$stage" -cf - . | age "${recipients[@]}" -o "$out"
  local size sha
  size="$(wc -c < "$out" | tr -d ' ')"
  sha="$(hash_file "$out")"
  printf '%s  %s\n' "$sha" "$(basename "$key")" > "$work/archive.sha256"

  r2 s3 cp --no-progress "$out" "s3://$R2_BUCKET/$key"
  r2 s3 cp --no-progress "$work/archive.sha256" "s3://$R2_BUCKET/$key.sha256"

  # Read it back: an upload that "succeeded" but stored nothing is not a backup.
  local stored
  stored="$(r2 s3api head-object --bucket "$R2_BUCKET" --key "$key" --query ContentLength --output text)"
  [ "$stored" = "$size" ] || die "uploaded size $stored does not match local size $size for $key"

  summary "- \`$key\`: $size bytes, sha256 \`$sha\`"
}

fingerprint_rows() { awk -F'\t' '{ s += $2 } END { print s + 0 }' "$1"; }

case "$kind" in
  hourly)
    check_database
    server_version="$(psql "$PROD_DATABASE_URL" -X -At -c 'show server_version')"
    args=()
    while IFS= read -r line; do
      line="${line%%#*}"; line="$(echo "$line" | tr -d '[:space:]')"
      [ -n "$line" ] && args+=(--table="$line")
    done < "$here/critical-tables.txt"
    [ ${#args[@]} -gt 0 ] || die "critical-tables.txt lists no tables"
    pg_dump "$PROD_DATABASE_URL" --format=custom --strict-names "${args[@]}" --file="$stage/critical.dump"
    "$here/fingerprint.sh" "$stage/critical.dump" > "$stage/manifest.tsv"
    ;;

  nightly)
    check_database
    server_version="$(psql "$PROD_DATABASE_URL" -X -At -c 'show server_version')"
    # Roles without passwords: enough to recreate grants; passwords are reset on restore.
    pg_dumpall --dbname="$PROD_DATABASE_URL" --roles-only --no-role-passwords --file="$stage/roles.sql"
    # Application schemas, schema and data. entitlements must come with public
    # (docs/SCHEMA-BASELINE.md): public triggers call its functions.
    pg_dump "$PROD_DATABASE_URL" --format=custom \
      --schema=public --schema=entitlements --schema=supabase_migrations \
      --file="$stage/app.dump"
    # Storage metadata (bucket settings, object rows); the files are in the storage archive.
    pg_dump "$PROD_DATABASE_URL" --format=custom --strict-names \
      --table=storage.buckets --table=storage.objects \
      --file="$stage/storage-meta.dump"
    # --table leaves out the types and functions those two tables need
    # (storage.buckettype on newer Supabase), so a restore into an empty
    # database fails. The storage schema's definitions, no data, let the
    # restore drill create them first (restore-drill.sh).
    pg_dump "$PROD_DATABASE_URL" --schema-only --schema=storage --no-owner --no-privileges \
      --file="$stage/storage-schema.sql"
    { "$here/fingerprint.sh" "$stage/app.dump"; "$here/fingerprint.sh" "$stage/storage-meta.dump"; } \
      | sort -t$'\t' -k1,1 > "$stage/manifest.tsv"
    ;;

  storage)
    need SUPABASE_S3_ENDPOINT SUPABASE_S3_REGION SUPABASE_S3_ACCESS_KEY_ID SUPABASE_S3_SECRET_ACCESS_KEY
    buckets="$(supa_s3 s3api list-buckets --query 'Buckets[].Name' --output text)"
    [ -n "$buckets" ] && [ "$buckets" != "None" ] || die "Supabase Storage returned no buckets"
    mkdir -p "$stage/files"
    for b in $buckets; do
      mkdir -p "$stage/files/$b"
      supa_s3 s3 sync --no-progress --only-show-errors "s3://$b" "$stage/files/$b"
    done
    # path, bytes, sha256 per file: what the drill checks after decrypting.
    ( cd "$stage/files" && find . -type f | sed 's|^\./||' | sort | while IFS= read -r f; do
        printf '%s\t%s\t%s\n' "$f" "$(wc -c < "$f" | tr -d ' ')" "$(hash_file "$f")"
      done ) > "$stage/files-manifest.tsv"
    files="$(wc -l < "$stage/files-manifest.tsv" | tr -d ' ')"
    write_meta "$(echo "$buckets" | wc -w | tr -d ' ')" "$files"
    summary "### Storage backup $ts"
    summary "- buckets: $(echo "$buckets" | wc -w | tr -d ' '), files: $files"
    encrypt_and_upload "storage/$day_path/stellr-storage-$ts.tar.age"
    exit 0
    ;;
esac

tables="$(wc -l < "$stage/manifest.tsv" | tr -d ' ')"
rows="$(fingerprint_rows "$stage/manifest.tsv")"
[ "$tables" -gt 0 ] || die "the dump holds no tables"
write_meta "$tables" "$rows"
summary "### Backup ($kind) $ts"
summary "- tables: $tables, rows: $rows"
key="$kind/$day_path/stellr-$kind-$ts.tar.age"
encrypt_and_upload "$key"

# No monthly/ copy. A longer-locked monthly archive would keep pending-consent
# under-13 accounts (and the parent email collected only to ask for consent)
# and erased people well past their purge dates, under a lock nobody can
# shorten (COPPA §312.5(c)(1), §312.10). Nothing outlives the 35-day nightly
# unless counsel approves a longer period: docs/compliance/retention-schedule.md
# row 29, docs/RUNBOOK-backups.md §1.
