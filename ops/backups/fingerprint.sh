#!/usr/bin/env bash
# fingerprint.sh — one line per table in a pg_dump: name, row count, SHA-256.
#
#   ops/backups/fingerprint.sh app.dump > manifest.tsv     # custom-format dump
#   pg_dump ... --format=plain | ops/backups/fingerprint.sh --sql - > manifest.tsv
#
# Output, tab-separated and sorted by table (LC_ALL=C):
#
#   public.members<TAB>1234<TAB><sha256 of the table's sorted COPY lines>
#
# Why it works this way: the backup job fingerprints the dump it just took,
# and the restore drill fingerprints a fresh dump of the scratch database it
# restored into. Both sides are pg_dump COPY text produced by the same code
# path, so a matching manifest proves every row came back byte-for-byte —
# without a second query against production that would see a different moment
# than the dump did. Rows are sorted before hashing, so row order (which a
# restore does not preserve) does not matter.
#
# Run pg_dump with PGTZ=UTC on both sides: timestamptz values are printed in
# the session time zone, and a different zone would change every hash.
#
# Every table in the dump appears, including empty ones (0 rows, hash of no
# input). Contains no row data, only names, counts and hashes, so a manifest
# is safe to print in a drill report.
set -euo pipefail
export LC_ALL=C

usage() { echo "usage: $0 <custom-format dump> | --sql <file|->" >&2; exit 2; }

[ $# -ge 1 ] || usage

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

work="$(mktemp -d "${TMPDIR:-/tmp}/fingerprint.XXXXXX")"
trap 'rm -rf "$work"' EXIT

emit_sql() {
  if [ "$1" = "--sql" ]; then
    [ $# -eq 2 ] || usage
    if [ "$2" = "-" ]; then cat; else cat "$2"; fi
  else
    [ -f "$1" ] || { echo "fingerprint: no such dump: $1" >&2; exit 2; }
    pg_restore --data-only --file=- "$1"
  fi
}

# Stage 1: tag each data line with its table; mark every COPY block so empty
# tables are still listed. H sorts before R, so a table's marker comes first.
emit_sql "$@" | awk -v OFS='\t' '
  /^COPY / && !inside { tbl = $2; inside = 1; print tbl, "H", ""; next }
  inside && $0 == "\\." { inside = 0; next }
  inside { print tbl, "R", $0 }
' > "$work/tagged"

# Stage 2: sort by table, then row text, so the hash is order-independent.
sort "$work/tagged" > "$work/sorted"

# Stage 3: one file per table (rows only, marker dropped), numbered so table
# names never become file names.
awk -F'\t' -v dir="$work" '
  $1 != cur {
    if (cur != "") close(file)
    cur = $1; n++; file = dir "/t" n
    print n "\t" cur > (dir "/index")
    printf "" > file
  }
  $2 == "R" { print substr($0, length($1) + 4) > file }
' "$work/sorted"

[ -f "$work/index" ] || exit 0

while IFS=$'\t' read -r n tbl; do
  rows=$(wc -l < "$work/t$n" | tr -d ' ')
  printf '%s\t%s\t%s\n' "$tbl" "$rows" "$(hash_file "$work/t$n")"
done < "$work/index" | sort -t$'\t' -k1,1
