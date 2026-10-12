#!/usr/bin/env bash
# Restores a dump from run-dump.sh into a NEW, EMPTY project, in one transaction.
#
#   restore.sh <dump-dir> <target-env-file> <expected-target-ref>
#
# Refuses Ireland production, a target whose ref isn't <expected-target-ref>,
# and a target that isn't empty (public tables, auth users or storage objects).
# Any error rolls everything back.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
source "$here/lib/env.sh"

[[ $# -eq 3 ]] || die "usage: restore.sh <dump-dir> <target-env-file> <expected-target-ref>"
D=$1
load_env "$2"
guard_not_ireland
[[ "$REF" == "$3" ]] || die "target is $REF, expected $3"
for f in roles schema data; do [[ -s "$D/$f.sql" ]] || die "missing $D/$f.sql"; done

not_empty=$(ro_psql -c "select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p'))
  + (select count(*) from auth.users) + (select count(*) from storage.objects)
  + (select count(*) from storage.buckets);")
[[ "$not_empty" == "0" ]] || die "target $REF is not empty ($not_empty objects/rows). Restore needs a fresh project."

echo "Restoring $D → $REF"
start=$(date +%s)
"$PG_BIN/psql" -X --single-transaction --variable ON_ERROR_STOP=1 \
  --file "$D/roles.sql" \
  --file "$here/sql/pre-restore.sql" \
  --file "$D/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$D/data.sql" \
  > "$D/restore.log" 2>&1 || { tail -5 "$D/restore.log"; die "restore failed, rolled back (log: $D/restore.log)"; }
echo "Restored in $(( $(date +%s) - start ))s (log: $D/restore.log)"
