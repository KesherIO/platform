#!/usr/bin/env bash
# Read-only report of one project (stage 6 checks; also used after the restore).
#
#   inspect.sh <env-file> <report-file> [old-ref]
#
# old-ref: project ref to search for in stored URLs (default: Ireland).
# Ireland production needs ALLOW_IRELAND=yes. Diff two reports to compare
# projects: diff ireland.txt us.txt
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/lib/env.sh"

[[ $# -ge 2 ]] || die "usage: inspect.sh <env-file> <report-file> [old-ref]"
load_env "$1"
guard_ireland_read
ro_psql -v old_ref="${3:-$IRELAND_REF}" -f "$here/sql/inspect.sql" 2>&1 \
  | sed -E 's/^psql:[^:]*:[0-9]+: NOTICE:  //' > "$2"
echo "Report for $REF → $2 ($(wc -l < "$2" | tr -d ' ') lines)"
