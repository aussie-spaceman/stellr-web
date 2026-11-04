#!/usr/bin/env bash
# restore-drill.sh — prove a backup restores: decrypt it, restore it into a
# scratch local Postgres, and compare every table's row count and hash with
# the manifest written when the backup was taken. Prints a report.
#
#   ops/backups/restore-drill.sh --identity ~/keys/stellr-backup.agekey --nightly latest
#   ops/backups/restore-drill.sh --identity KEY --nightly latest --hourly latest --storage latest \
#       --report drill-2026-12-01.txt
#   ops/backups/restore-drill.sh --identity KEY --nightly ./stellr-nightly-20261201T092300Z.tar.age
#
# Archives: a local file, or `latest` to fetch the newest one from R2 (needs
# R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET — use a
# read-only R2 token for drills).
#
# Scratch database: by default a throwaway Docker container (SCRATCH_IMAGE,
# default postgres:17) bound to 127.0.0.1 and removed at the end. Or set
# SCRATCH_PGHOST / SCRATCH_PGPORT / SCRATCH_PGUSER / SCRATCH_PGPASSWORD to a
# local server you own; the host must be local (localhost, 127.0.0.1, ::1 or
# a socket directory) so a drill can never restore into a real database.
#
# What passes:
#   1. every table in each database archive restores with the same row count
#      and the same content hash (fingerprint.sh on a fresh dump of scratch);
#   2. count(*) in scratch agrees with the manifest;
#   3. nightly: every e-sign audit chain verifies (esign_verify_audit), and
#      the audit anchor is printed — the same value lib/esign/replicate.ts
#      writes into the daily e-sign export, so the two can be compared;
#   4. storage: every file matches its recorded size and SHA-256, and every
#      signed agreement's file matches agreements.signed_pdf_sha256 (the
#      check scripts/esign-restore-drill.ts makes against the Drive copies).
#
# Decrypted data is personal data. It lives only in a temp directory that is
# deleted on exit; run drills on an encrypted disk. The report holds table
# names, counts and hashes only, so it is safe to file.
set -euo pipefail
export LC_ALL=C
export PGTZ=UTC
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
identity="" nightly="" hourly="" storage="" report="" keep=0

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --identity) identity="$2"; shift 2 ;;
    --nightly)  nightly="$2"; shift 2 ;;
    --hourly)   hourly="$2"; shift 2 ;;
    --storage)  storage="$2"; shift 2 ;;
    --report)   report="$2"; shift 2 ;;
    --keep)     keep=1; shift ;;
    -h|--help)  usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

[ -n "$identity" ] && [ -f "$identity" ] || { echo "--identity <age private key file> is required" >&2; exit 2; }
[ -n "$nightly$hourly$storage" ] || { echo "give at least one of --nightly, --hourly, --storage" >&2; exit 2; }
for tool in age psql pg_restore pg_dump tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is not installed" >&2; exit 2; }
done
major="$(pg_restore --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
[ "$major" -ge 17 ] || { echo "pg_restore $major is older than the server (17); install PostgreSQL 17 client tools" >&2; exit 2; }

started="$(date +%s)"
work="$(mktemp -d "${TMPDIR:-/tmp}/stellr-drill.XXXXXX")"
container=""
cleanup() {
  if [ -n "$container" ] && [ "$keep" -eq 0 ]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

out="$work/report.txt"
say() { echo "$*" | tee -a "$out"; }
failures=0
fail() { say "FAIL  $*"; failures=$((failures + 1)); }

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

r2() {
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION=auto \
    aws --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" "$@"
}

# Resolve `latest` to a downloaded file; check the .sha256 sidecar when there is one.
fetch() {
  local kind="$1" src="$2" dest="$work/$1.tar.age"
  if [ "$src" = "latest" ]; then
    for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
      [ -n "${!v:-}" ] || { echo "$v is needed to fetch the latest $kind backup" >&2; exit 2; }
    done
    local key
    key="$(r2 s3 ls "s3://$R2_BUCKET/$kind/" --recursive | awk '{print $4}' | grep '\.tar\.age$' | sort | tail -1)"
    [ -n "$key" ] || { echo "no $kind backup in R2" >&2; exit 1; }
    r2 s3 cp --no-progress --only-show-errors "s3://$R2_BUCKET/$key" "$dest"
    r2 s3 cp --no-progress --only-show-errors "s3://$R2_BUCKET/$key.sha256" "$dest.sha256" 2>/dev/null || true
    src_label="$key"
  else
    [ -f "$src" ] || { echo "no such file: $src" >&2; exit 2; }
    cp "$src" "$dest"
    [ -f "$src.sha256" ] && cp "$src.sha256" "$dest.sha256"
    src_label="$(basename "$src")"
  fi
  if [ -f "$dest.sha256" ]; then
    if [ "$(cut -d' ' -f1 "$dest.sha256")" = "$(hash_file "$dest")" ]; then say "ok    $kind ciphertext matches its .sha256 sidecar"
    else fail "$kind ciphertext does not match its .sha256 sidecar (corrupt or altered)"; fi
  fi
  mkdir -p "$work/$kind"
  age --decrypt --identity "$identity" "$dest" | tar -C "$work/$kind" -xf -
  rm -f "$dest"
  local created
  created="$(sed -n 's/.*"created_at": "\([^"]*\)".*/\1/p' "$work/$kind/meta.json")"
  say "      $kind archive: $src_label (taken $created)"
}

start_scratch() {
  if [ -n "${SCRATCH_PGHOST:-}" ]; then
    case "$SCRATCH_PGHOST" in localhost|127.0.0.1|::1|/*) ;; *)
      echo "SCRATCH_PGHOST must be local (localhost, 127.0.0.1, ::1 or a socket path)" >&2; exit 2 ;;
    esac
    export PGHOST="$SCRATCH_PGHOST" PGPORT="${SCRATCH_PGPORT:-5432}" PGUSER="${SCRATCH_PGUSER:-postgres}"
    export PGPASSWORD="${SCRATCH_PGPASSWORD:-}"
  else
    command -v docker >/dev/null 2>&1 || { echo "docker is needed, or set SCRATCH_PGHOST" >&2; exit 2; }
    local pw; pw="drill-$(date +%s)-$RANDOM"
    container="stellr-drill-$$"
    docker run -d --rm --name "$container" -e POSTGRES_PASSWORD="$pw" -p 127.0.0.1::5432 \
      "${SCRATCH_IMAGE:-postgres:17}" >/dev/null
    export PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD="$pw"
    PGPORT="$(docker port "$container" 5432/tcp | head -1 | sed 's/.*://')"; export PGPORT
  fi
  unset PGDATABASE PGSERVICE
  for _ in $(seq 1 60); do pg_isready -q -d postgres && return 0; sleep 1; done
  echo "scratch Postgres did not start" >&2; exit 1
}

valid_table() { [[ "$1" =~ ^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$ ]]; }

# Restore one database archive into its own fresh database and verify it.
restore_and_verify() {
  local kind="$1" db="drill_$1" dir="$work/$1"
  say ""
  say "== $kind: restore into scratch database $db"
  psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db"
  psql -X -q -d "$db" -v ON_ERROR_STOP=1 -f "$here/scratch-prep.sql" >/dev/null
  if [ -f "$dir/roles.sql" ]; then
    local role_errs
    role_errs="$(psql -X -q -d "$db" -f "$dir/roles.sql" 2>&1 >/dev/null | grep -c 'ERROR' || true)"
    say "      roles.sql applied ($role_errs statements refused, expected for Supabase-reserved roles)"
  fi
  local d errs
  for d in "$dir"/*.dump; do
    pg_restore --no-owner --dbname="$db" "$d" 2> "$work/$kind-$(basename "$d").log" || true
    errs="$(grep -c 'error:' "$work/$kind-$(basename "$d").log" || true)"
    say "      pg_restore $(basename "$d"): $errs objects refused (Supabase-only extensions, auth, grants); judged by data below"
  done

  # 1. Fresh dump of scratch, fingerprinted the same way as at backup time.
  local args=() t
  while IFS=$'\t' read -r t _ _; do args+=(--table="$t"); done < "$dir/manifest.tsv"
  pg_dump --dbname="$db" --format=custom "${args[@]}" --file="$work/$kind-redump.dump" 2>/dev/null || true
  if [ -f "$work/$kind-redump.dump" ]; then "$here/fingerprint.sh" "$work/$kind-redump.dump" > "$work/$kind-actual.tsv"
  else : > "$work/$kind-actual.tsv"; fi
  say "-- table by table (row count and SHA-256 of the sorted rows)"
  if "$here/compare-manifests.sh" "$dir/manifest.tsv" "$work/$kind-actual.tsv" | tee -a "$out"; then :
  else failures=$((failures + 1)); fi

  # 2. count(*) agrees with the manifest (independent of pg_dump).
  local rows n bad=0
  while IFS=$'\t' read -r t rows _; do
    valid_table "$t" || continue
    n="$(psql -X -At -d "$db" -c "SELECT count(*) FROM $t" 2>/dev/null || echo "missing")"
    if [ "$n" != "$rows" ]; then say "COUNT $t  manifest $rows, count(*) $n"; bad=$((bad + 1)); fi
  done < "$dir/manifest.tsv"
  if [ "$bad" -eq 0 ]; then say "ok    count(*) agrees with the manifest for every table"
  else fail "$bad table(s) where count(*) disagrees with the manifest"; fi
}

esign_checks() {
  local db="drill_nightly"
  say ""
  say "== nightly: e-sign audit trail"
  if [ "$(psql -X -At -d "$db" -c "SELECT to_regprocedure('public.esign_verify_audit(uuid)') IS NOT NULL")" != "t" ]; then
    fail "esign_verify_audit did not restore; cannot verify audit chains"
    return
  fi
  local chains broken anchor
  chains="$(psql -X -At -d "$db" -c "SELECT count(DISTINCT envelope_row) FROM public.esign_audit_events")"
  broken="$(psql -X -At -d "$db" -c "SELECT count(*) FROM (SELECT DISTINCT envelope_row FROM public.esign_audit_events) e WHERE public.esign_verify_audit(e.envelope_row) IS NOT NULL")"
  # Same anchor as exportTables() in lib/esign/replicate.ts.
  anchor="$(psql -X -At -d "$db" -c "SELECT encode(extensions.digest(coalesce(string_agg(envelope_row::text || ':' || last_id || ':' || hash, E'\n' ORDER BY envelope_row::text COLLATE \"C\"), ''), 'sha256'), 'hex') FROM public.esign_audit_heads()")"
  if [ "$broken" = "0" ]; then say "ok    $chains audit chains verify"; else fail "$broken of $chains audit chains do not verify"; fi
  say "      audit anchor: $anchor (compare with the e-sign export of the same day)"
}

storage_checks() {
  local dir="$work/storage" bad=0 total=0 path size sha
  say ""
  say "== storage: files against their manifest"
  while IFS=$'\t' read -r path size sha; do
    total=$((total + 1))
    if [ ! -f "$dir/files/$path" ]; then bad=$((bad + 1)); continue; fi
    [ "$(wc -c < "$dir/files/$path" | tr -d ' ')" = "$size" ] && [ "$(hash_file "$dir/files/$path")" = "$sha" ] || bad=$((bad + 1))
  done < "$dir/files-manifest.tsv"
  if [ "$bad" -eq 0 ]; then say "ok    $total files match their recorded size and SHA-256"
  else fail "$bad of $total files are missing or do not match"; fi

  if [ -n "$nightly" ]; then
    local checked=0 missing=0 mismatched=0 p s
    while IFS=$'\t' read -r p s; do
      checked=$((checked + 1))
      if [ ! -f "$dir/files/signed-agreements/$p" ]; then missing=$((missing + 1)); continue; fi
      [ "$(hash_file "$dir/files/signed-agreements/$p")" = "$s" ] || mismatched=$((mismatched + 1))
    done < <(psql -X -At -F $'\t' -d drill_nightly -c \
      "SELECT signed_pdf_path, signed_pdf_sha256 FROM public.agreements WHERE signed_pdf_path IS NOT NULL AND signed_pdf_sha256 IS NOT NULL")
    if [ "$mismatched" -eq 0 ]; then say "ok    signed agreements: $checked checked, 0 hash mismatches"
    else fail "signed agreements: $mismatched of $checked files do not match agreements.signed_pdf_sha256"; fi
    [ "$missing" -eq 0 ] || say "warn  $missing signed agreement file(s) not in the storage archive (stored after it was taken, or lost: check)"
  fi
}

say "Stellr restore drill — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "Operator: ${USER:-unknown} on $(hostname -s 2>/dev/null || echo unknown)"
say ""
start_scratch
say "      scratch Postgres: $PGHOST:$PGPORT ($(psql -X -At -d postgres -c 'show server_version'))"
[ -z "$nightly" ] || fetch nightly "$nightly"
[ -z "$hourly" ]  || fetch hourly "$hourly"
[ -z "$storage" ] || fetch storage "$storage"

[ -z "$nightly" ] || { restore_and_verify nightly; esign_checks; }
[ -z "$hourly" ]  || restore_and_verify hourly
[ -z "$storage" ] || storage_checks

elapsed=$(( $(date +%s) - started ))
say ""
say "Elapsed: $((elapsed / 60)) min $((elapsed % 60)) s (RTO target: under 4 hours end to end)"
if [ "$failures" -eq 0 ]; then say "RESULT: PASS"; else say "RESULT: FAIL ($failures problem(s))"; fi
[ -z "$report" ] || cp "$out" "$report"
exit $(( failures > 0 ? 1 : 0 ))
