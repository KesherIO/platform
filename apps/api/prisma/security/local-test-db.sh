#!/usr/bin/env bash
# Throwaway local PostgreSQL 17 with Supabase-like roles, loaded from a
# schema-only dump (no data). Used to run the security tests against a copy
# of a real project's structure and grants without touching that project.
#
#   local-test-db.sh start <schema.sql>   # create, load, print the URL
#   local-test-db.sh stop                 # stop and delete it
#
# Get a schema-only dump with dump-schema.sh. The cluster lives in
# $TMPDIR/vet-ai-security-pg (outside the repo), listens on 127.0.0.1:55432
# only, and trusts local connections — never load real data into it.
set -euo pipefail
PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
DIR=${LOCAL_PG_DIR:-${TMPDIR:-/tmp}/vet-ai-security-pg}
PORT=${LOCAL_PG_PORT:-55432}
here=$(cd "$(dirname "$0")" && pwd)

case "${1:-}" in
  start)
    SCHEMA=${2:?usage: local-test-db.sh start <schema.sql>}
    [[ -e "$DIR" ]] && { "$PG_BIN/pg_ctl" -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
    "$PG_BIN/initdb" -D "$DIR" -U supabase_admin --auth=trust -E UTF8 --locale=C >/dev/null
    "$PG_BIN/pg_ctl" -D "$DIR" -l "$DIR/server.log" \
      -o "-c listen_addresses=127.0.0.1 -c port=$PORT -c unix_socket_directories=$DIR" -w start >/dev/null
    psql() { "$PG_BIN/psql" -X -q -h 127.0.0.1 -p "$PORT" -d postgres -v ON_ERROR_STOP=1 "$@"; }
    psql -U supabase_admin -f "$here/local-supabase-roles.sql"
    # App objects are created by postgres, as on Supabase. Supabase's own
    # default privileges (FOR ROLE supabase_admin) need the superuser.
    grep -v 'FOR ROLE "supabase_admin"' "$SCHEMA" | psql -U postgres --single-transaction
    grep '^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"' "$SCHEMA" \
      | psql -U supabase_admin --single-transaction
    echo "postgresql://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$DIR" -m fast stop >/dev/null 2>&1 || true
    rm -rf "$DIR"
    echo "stopped and removed $DIR"
    ;;
  *) echo "usage: local-test-db.sh start <schema.sql> | stop" >&2; exit 1 ;;
esac
