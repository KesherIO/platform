#!/usr/bin/env bash
# Schema-only dump of the app schemas (public, app_private) of one project:
# tables, RLS, policies, functions, grants, default privileges. No data.
# Read-only (pg_dump runs in a read-only snapshot). Feed it to local-test-db.sh.
#
#   dump-schema.sh <env-file> <out.sql>
#
# <env-file> is a gitignored file with DATABASE_URL (e.g. .env.prod.local).
# <out.sql> must be outside the repo: schemas are not secrets, but this keeps
# production artefacts out of git.
set -euo pipefail
PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
[[ $# -eq 2 ]] || { echo "usage: dump-schema.sh <env-file> <out.sql>" >&2; exit 1; }
repo=$(cd "$(dirname "$0")/../../../.." && pwd)
out_dir=$(mkdir -p "$(dirname "$2")" && cd "$(dirname "$2")" && pwd)
[[ "$out_dir/" != "$repo/"* ]] || { echo "✖ <out.sql> is inside the repo" >&2; exit 1; }

url=$(python3 - "$1" <<'PY'
import re, sys
from urllib.parse import urlparse
for line in open(sys.argv[1]):
    m = re.match(r'^DATABASE_URL=(.*)$', line.strip())
    if m:
        url = m.group(1).strip().strip("'\"")
        u = urlparse(url)
        if u.fragment or u.port is None:
            sys.exit('DATABASE_URL does not parse: URL-encode the password (# -> %23, @ -> %40)')
        print(url); break
else:
    sys.exit('DATABASE_URL not found')
PY
)
PGCONNECT_TIMEOUT=15 "$PG_BIN/pg_dump" "$url" --schema-only --quote-all-identifiers \
  --schema=public --schema=app_private --no-owner --role=postgres \
  | sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/; s/^\\(un)?restrict .*$/-- &/' > "$2"
chmod 600 "$2"
echo "Schema of public + app_private → $2 ($(grep -c '^CREATE TABLE' "$2") tables)"
