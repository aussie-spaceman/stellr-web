#!/usr/bin/env bash
# compare-manifests.sh — compare two fingerprint.sh manifests, table by table.
#
#   ops/backups/compare-manifests.sh <expected.tsv> <actual.tsv>
#
# expected = the manifest written when the backup was taken.
# actual   = the manifest of a fresh dump of the restored scratch database.
#
# Prints one line per table:
#   OK        table  rows
#   ROWS      table  expected N, restored M
#   HASH      table  same N rows, different content
#   MISSING   table  in the backup, not restored
#   EXTRA     table  restored, not in the backup
# then a summary line. Exits 0 only when every table is OK.
set -euo pipefail
export LC_ALL=C

[ $# -eq 2 ] || { echo "usage: $0 <expected.tsv> <actual.tsv>" >&2; exit 2; }
for f in "$1" "$2"; do [ -f "$f" ] || { echo "compare: no such manifest: $f" >&2; exit 2; }; done

work="$(mktemp -d "${TMPDIR:-/tmp}/compare.XXXXXX")"
trap 'rm -rf "$work"' EXIT
sort -t$'\t' -k1,1 "$1" > "$work/e"
sort -t$'\t' -k1,1 "$2" > "$work/a"

join -t$'\t' -a1 -a2 -e '-' -o 0,1.2,1.3,2.2,2.3 "$work/e" "$work/a" | awk -F'\t' '
  {
    t = $1; er = $2; eh = $3; ar = $4; ah = $5
    if (eh == "-")      { printf "EXTRA    %s  restored, not in the backup\n", t; bad++ }
    else if (ah == "-") { printf "MISSING  %s  in the backup, not restored\n", t; bad++ }
    else if (er != ar)  { printf "ROWS     %s  expected %s, restored %s\n", t, er, ar; bad++ }
    else if (eh != ah)  { printf "HASH     %s  same %s rows, different content\n", t, er; bad++ }
    else                { printf "OK       %s  %s\n", t, er; ok++; rows += er }
    n++
  }
  END {
    if (n == 0) { print "FAIL: both manifests are empty"; exit 1 }
    printf "%s: %d of %d tables match (%d rows)\n", (bad ? "FAIL" : "PASS"), ok, n, rows
    exit bad ? 1 : 0
  }
'
