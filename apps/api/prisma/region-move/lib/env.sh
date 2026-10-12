# Shared helpers for the region move. Source it, don't run it.
#
# Credentials are never stored in this directory: every script takes the path
# of a gitignored env file (e.g. .env.prod.local, .env.prod-us.local) and reads
# DATABASE_URL / SUPABASE_URL / keys from it at run time.

# Ireland production. Public value (also in environment.production.ts).
IRELAND_REF=mqwurrtupumsizsvurpx

# PostgreSQL 17 client tools, matching both servers (Ireland 17.6, US 17.11).
PG_BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}

die() { echo "✖ $*" >&2; exit 1; }

# load_env <env-file>
# Sets PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (for pg_dump/psql), DB_URL,
# API_URL, SERVICE_KEY, ANON_KEY and REF (the project ref of DATABASE_URL).
# Fails when SUPABASE_URL or the keys belong to another project than DATABASE_URL.
load_env() {
  local file=$1
  [[ -f "$file" ]] || die "env file not found: $file"
  [[ -x "$PG_BIN/psql" ]] || die "PostgreSQL 17 tools not found in $PG_BIN (brew install postgresql@17)"
  local vars
  vars=$(python3 - "$file" <<'PY'
import base64, json, re, shlex, sys
from urllib.parse import urlparse, unquote
env = {}
for line in open(sys.argv[1]):
    m = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$', line.strip())
    if m: env[m.group(1)] = m.group(2).strip().strip("'\"")
url = env.get('DATABASE_URL') or sys.exit('DATABASE_URL missing')
u = urlparse(url)
if u.fragment or u.port is None:
    sys.exit('DATABASE_URL does not parse: URL-encode special characters in the password (# -> %23, @ -> %40, / -> %2F)')
ref = (u.username or '').split('.', 1)[-1]
def claims(jwt):
    p = jwt.split('.')[1]; p += '=' * (-len(p) % 4)
    return json.loads(base64.urlsafe_b64decode(p))
api = env.get('SUPABASE_URL', '')
if api and api.rstrip('/') != f'https://{ref}.supabase.co':
    sys.exit('SUPABASE_URL is a different project than DATABASE_URL')
for k in ('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'):
    if env.get(k) and claims(env[k]).get('ref') != ref:
        sys.exit(f'{k} is a different project than DATABASE_URL')
out = {
    'PGHOST': u.hostname, 'PGPORT': str(u.port), 'PGUSER': unquote(u.username or ''),
    'PGPASSWORD': unquote(u.password or ''), 'PGDATABASE': u.path.lstrip('/') or 'postgres',
    'DB_URL': url, 'API_URL': api, 'SERVICE_KEY': env.get('SUPABASE_SERVICE_ROLE_KEY', ''),
    'ANON_KEY': env.get('SUPABASE_ANON_KEY', ''), 'REF': ref,
}
for k, v in out.items(): print(f'{k}={shlex.quote(v)}')
PY
  ) || die "could not load $file"
  eval "$vars"
  export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
  export PGCONNECT_TIMEOUT=${PGCONNECT_TIMEOUT:-15}
}

# Refuse Ireland production unless ALLOW_IRELAND=yes (read-only use only).
guard_ireland_read() {
  if [[ "$REF" == "$IRELAND_REF" && "${ALLOW_IRELAND:-}" != "yes" ]]; then
    die "this is Ireland production ($IRELAND_REF). Set ALLOW_IRELAND=yes once reading it is authorized."
  fi
}

# Never write to Ireland production, whatever ALLOW_IRELAND says.
guard_not_ireland() {
  [[ "$REF" != "$IRELAND_REF" ]] || die "refusing to write to Ireland production ($IRELAND_REF)"
}

# psql in a read-only session. The Supabase pooler ignores connect-time
# options, so the session is switched to read-only and checked first.
ro_psql() {
  "$PG_BIN/psql" -X -q -A -t -v ON_ERROR_STOP=1 \
    -c 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY' \
    -c "DO \$\$ BEGIN IF current_setting('transaction_read_only') <> 'on' THEN RAISE EXCEPTION 'session is not read-only'; END IF; END \$\$" \
    "$@"
}
