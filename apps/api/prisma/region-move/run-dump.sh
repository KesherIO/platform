#!/usr/bin/env bash
# Dumps one Supabase project (roles, schema, data). Read-only on the source.
#
#   run-dump.sh <env-file> <out-dir>
#
# Ireland production is refused unless ALLOW_IRELAND=yes. The output contains
# real data (users, password hashes): keep <out-dir> outside the repo.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/lib/env.sh"

[[ $# -eq 2 ]] || die "usage: run-dump.sh <env-file> <out-dir>"
load_env "$1"
guard_ireland_read
OUT=$2
case "$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/" in
  "$(cd "$here/../../../.." && pwd)/"*) die "out-dir is inside the repo; use e.g. ~/region-move/dumps/<name>" ;;
esac

mkdir -p "$OUT"; chmod 700 "$OUT"
echo "Dumping $REF → $OUT"
bash "$here/roles.sh"  > "$OUT/roles.sql"
bash "$here/schema.sh" > "$OUT/schema.sql"
bash "$here/data.sh"   > "$OUT/data.sql"
chmod 600 "$OUT"/*.sql
wc -l "$OUT"/*.sql
