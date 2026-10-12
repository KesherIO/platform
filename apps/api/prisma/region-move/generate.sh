#!/usr/bin/env bash
# Regenerates the dump scripts from the Supabase CLI and re-applies our changes.
#
#   bash apps/api/prisma/region-move/generate.sh
#
# 1. generated/*.generated.sh: exactly what `supabase db dump --dry-run` prints,
#    with a placeholder connection (no credentials, nothing is contacted).
# 2. roles.sh / schema.sh / data.sh: the same files with only these changes:
#    - lines 4–8: placeholder `export PG…=` lines → PG* variables from run-dump.sh,
#      plus PATH pointing at PostgreSQL 17;
#    - roles.sh only (fix 1): one extra sed that comments out
#      `GRANT … ON PARAMETER … TO <Supabase role>`: `postgres` isn't a superuser and
#      can't run it, and new projects already have those grants.
# Every Supabase exclusion and transformation is kept unchanged.
# Review with: diff generated/roles.generated.sh roles.sh (and schema, data).
set -euo pipefail
cd "$(dirname "$0")"

CLI_VERSION=2.120.0
PLACEHOLDER='postgresql://postgres.PLACEHOLDERREFxxxxxxx:PLACEHOLDER@placeholder.invalid:5432/postgres'
cli() { npx -y "supabase@$CLI_VERSION" db dump --db-url "$PLACEHOLDER" --dry-run "$@" 2>/dev/null; }

cli --role-only > generated/roles.generated.sh
cli > generated/schema.generated.sh
cli --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes \
  > generated/data.generated.sh

python3 - <<'PY'
ROLES_FIX = (
    "| sed -E 's/^GRANT (.+) ON PARAMETER (.+) TO \"(supabase_.*|pgsodium_.*|pgtle_admin|"
    "dashboard_user|authenticator|anon|authenticated|service_role|pgbouncer|postgres)\";$/"
    "-- [region-move] platform-managed: &/'"
)
CONNECTION = [
    '# Connection comes from run-dump.sh (PG* variables), never stored in this file.',
    ': "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"',
    'export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE',
    '# Matching client tools (server is PostgreSQL 17).',
    'export PATH="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}:$PATH"',
]
for name in ('roles', 'schema', 'data'):
    lines = open(f'generated/{name}.generated.sh').read().split('\n')
    head = [l.split('=')[0] for l in lines[3:8]]
    assert head == ['export PGHOST', 'export PGPORT', 'export PGUSER',
                    'export PGPASSWORD', 'export PGDATABASE'], (name, head)
    out = lines[:3] + CONNECTION + lines[8:]
    if name == 'roles':
        i = out.index('| uniq')
        out[i] = '| uniq \\'
        out.insert(i + 1, ROLES_FIX)
    open(f'{name}.sh', 'w').write('\n'.join(out))
PY
chmod +x roles.sh schema.sh data.sh
echo "Generated with supabase@$CLI_VERSION. Changes vs. the CLI output:"
for name in roles schema data; do
  echo "--- $name"; diff "generated/$name.generated.sh" "$name.sh" || true
done
