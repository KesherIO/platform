# Data API lockdown — runbook

## The problem (found 2026-10-12, Ireland production)

19 of the 45 tables in `public` had **RLS off**, and Supabase's default grants gave `anon`
and `authenticated` SELECT, INSERT, UPDATE and DELETE on **every** table. With the Data
API (PostgREST) on, anyone holding the anon key — public, shipped in both frontends —
could read and change those tables through `https://<ref>.supabase.co/rest/v1/<table>`.
Count-only checks confirmed it (no rows were read): e.g. `ordered_tests` 197 rows,
`timeline_events` 669, `veterinarian_credentials` 2.

## The fix: two layers

1. **Data API off** (Supabase dashboard → Project Settings → Data API).
   - Ireland: done 2026-10-12. REST and GraphQL now answer **503**; Auth and Storage
     unaffected; live apps tested.
   - Any new project (e.g. the US move): turn it off before loading data.
2. **Migration `20261008000000_lock_down_public_schema`** — so the data stays closed even
   if the Data API is ever turned back on:
   - RLS on for the 19 tables (no policies = deny-all);
   - `anon` / `authenticated` lose every privilege on `public` tables, sequences and
     functions; `app_private` helpers lose EXECUTE for `anon` / `authenticated` /
     `PUBLIC`, and the schema loses `USAGE` for `anon` / `authenticated`;
   - default privileges: tables, sequences and functions created later by `postgres`
     (i.e. by migrations) get no grants for `anon` / `authenticated`.

`service_role` keeps its grants (server-only key, used by Supabase services).

## Nothing depends on the Data API (checked in the repo)

| Part                     | Supabase usage                                                                    |
| ------------------------ | --------------------------------------------------------------------------------- |
| Clinic app (Angular)     | `supabase.auth.*` only (sign-in, sign-up, OTP, reset, session)                    |
| Lab portal (React)       | `supabase.auth.*` only                                                            |
| NestJS API               | Prisma as `postgres` (BYPASSRLS); supabase-js only for `auth.admin.*` and Storage |
| Background jobs          | none (no `@Cron`, queues or workers)                                              |
| Scripts (`prisma/seeds`) | Prisma, Storage API, Auth admin                                                   |
| Database side            | no webhooks, `pg_net`, `pg_cron`, Realtime tables or Edge Functions               |

No code calls `/rest/v1`, `/graphql/v1`, `.from()`, `.rpc()` or `.channel()` on a Supabase
client, and the API never switches to `anon` / `authenticated` (`SET ROLE`,
`request.jwt.*`).

## Impact on existing database objects

Checked on a copy of Ireland's schema (see Tests) with the migration applied:

| Object                                                                       | Before                                                    | After / impact                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 45 tables in `public`                                                        | 26 with RLS; `anon`/`authenticated` full rights on all 45 | RLS on all 45; no rights for those roles. `postgres` (API) and `service_role` unchanged (45/45)                                                                                                    |
| 29 RLS policies                                                              | evaluated for every Data API request                      | **left in place, never reached**: without table privileges a request is refused before RLS runs. Several were too broad (any signed-in user could read every result report); they no longer matter |
| `app_private.is_tenant_member`, `app_private.tenant_role` (SECURITY DEFINER) | executable by `anon`, `authenticated`, `PUBLIC`           | executable only by `postgres` (owner). Only the policies above use them; no app code calls them                                                                                                    |
| Functions in `public`                                                        | none                                                      | —                                                                                                                                                                                                  |
| Views, materialized views, column grants, triggers in `public`               | none                                                      | —                                                                                                                                                                                                  |
| Sequences                                                                    | `anon`/`authenticated` usage via default grants           | none                                                                                                                                                                                               |
| `extensions` (pgvector, pgcrypto, uuid-ossp)                                 | owned by `supabase_admin`                                 | **not touched**; the RAG query (`<=>` on `knowledge_chunks`) still runs as `postgres`                                                                                                              |
| `auth`, `storage` schemas                                                    | Supabase-managed, no custom policies                      | not touched                                                                                                                                                                                        |
| `supabase_admin` default privileges in `public`                              | grant to `anon`/`authenticated`                           | unchanged (can't be changed by `postgres`; only applies to objects Supabase itself creates — none). The tests catch any such object                                                                |

## Keeping future migrations closed

| Layer                                                               | What happens to a new table / function                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data API off                                                        | Not reachable over HTTP at all                                                                                                                                                                                                                                                                   |
| Default privileges (this migration)                                 | A new table / sequence / function created by a migration gets **no** grants for `anon` / `authenticated`                                                                                                                                                                                         |
| `migrations-security.spec.ts` (static, runs in every `nx test api`) | Fails if a model in `schema.prisma` has no `ENABLE ROW LEVEL SECURITY` in any migration; if a migration from the lockdown on creates a table without enabling RLS, creates a function without revoking `PUBLIC` EXECUTE, grants anything to `anon` / `authenticated` / `PUBLIC`, or disables RLS |
| `public-schema-lockdown.int.spec.ts` (database, opt-in)             | Fails on any table without RLS, any privilege for `anon` / `authenticated`, any function executable by `PUBLIC`, any default grant                                                                                                                                                               |

Postgres makes every **new function** executable by `PUBLIC`, and per-schema default
privileges can't remove that — so new functions need, in the same migration:

```sql
REVOKE EXECUTE ON FUNCTION public.my_fn(...) FROM PUBLIC, anon, authenticated;
```

New tables need `ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;` in the same
migration.

## Files

| File                                                                     | Purpose                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `apps/api/prisma/migrations/20261008000000_lock_down_public_schema/`     | The migration                                                  |
| `apps/api/prisma/security/rollback-lock-down-public-schema.sql`          | Emergency rollback to the pre-lockdown state (tested)          |
| `apps/api/src/security/migrations-security.spec.ts`                      | Static guard for future migrations (always runs)               |
| `apps/api/src/security/public-schema-lockdown.int.spec.ts`               | Database + HTTP checks (opt-in)                                |
| `apps/api/prisma/security/security-report.sql`                           | Read-only report of RLS, grants, functions, defaults, policies |
| `apps/api/prisma/security/dump-schema.sh`                                | Schema-only dump (no data) of `public` + `app_private`         |
| `apps/api/prisma/security/local-test-db.sh` + `local-supabase-roles.sql` | Throwaway local PostgreSQL 17 with Supabase-like roles         |

## Tests

```bash
cd apps/api
# Static guard — part of the normal suite
node ../../node_modules/.bin/jest --config jest.config.js migrations-security

# Database checks against a local copy of a project's schema (no data)
bash prisma/security/dump-schema.sh ../../.env.prod.local "$TMPDIR/sec/schema.sql"
bash prisma/security/local-test-db.sh start "$TMPDIR/sec/schema.sql"
psql postgresql://postgres@127.0.0.1:55432/postgres --single-transaction \
  -f prisma/migrations/20261008000000_lock_down_public_schema/migration.sql
SECURITY_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres \
  node ../../node_modules/.bin/jest --config jest.config.js public-schema-lockdown
bash prisma/security/local-test-db.sh stop

# Against a real project: read-only mode (write checks skipped)
SECURITY_TEST_READ_ONLY=1 SECURITY_DATABASE_URL="$DATABASE_URL" node … public-schema-lockdown
# Data API over HTTP: count-only HEAD requests with the anon key
DATA_API_URL=https://<ref>.supabase.co DATA_API_ANON_KEY=… node … public-schema-lockdown
```

`public-schema-lockdown.int.spec.ts` checks: RLS on every table; no `anon` /
`authenticated` privilege on tables, views, columns, sequences, functions or
`app_private`; no default grants for future objects; a table created later gets no
grants; `anon` and a signed-in `authenticated` user get `permission denied` reading every
table and writing the 19; the API connection (`postgres` through `PrismaPg`) still reads
every table and inserts / updates / deletes rows (rolled back); over HTTP no table answers
2xx to the anon key.

### Results (2026-10-12)

| Run                                                                                         | Result                                              |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Local copy of Ireland — security report diff against Ireland                                | **identical**                                       |
| Local copy, today's state                                                                   | 12 failed, 4 passed — the tests detect the exposure |
| Local copy + lockdown (state right after the hotfix)                                        | **16 passed**                                       |
| Local copy + lockdown + `20261010000001` (state after the final prod merge)                 | 16 passed                                           |
| Local copy, rollback script → report identical to Ireland today; lockdown re-applied        | 12 failed → 16 passed                               |
| Ireland, read-only mode, before the migration                                               | 9 failed (still open), 3 passed, nothing written    |
| Ireland Data API over HTTP, after turning it off                                            | **21 passed** (REST/GraphQL 503)                    |
| Static guard; mutation checks (open table, open function, grant to anon, model without RLS) | 6 passed; each mutation fails the guard             |
| Full API unit suite                                                                         | all passing                                         |

## Prisma migration history

Ireland has every migration up to `20261007000001` applied and
`20261010000001_client_tax_identity_and_import` pending (it ships with the client-import
release, which isn't on the `production` branch yet). The lockdown is named
`20261008000000`, between the two, so the history stays in name order everywhere.

Rehearsed on the local copy **with Ireland's real `_prisma_migrations` rows** (134 rows):

1. `prisma migrate status` → pending: `20261008000000…`, `20261010000001…`
2. `psql` the lockdown file in one transaction, then
   `prisma migrate resolve --applied 20261008000000_lock_down_public_schema`
   (Prisma's [hotfix workflow](https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing))
3. `prisma migrate status` → pending: only `20261010000001…`
4. later, `prisma migrate deploy` → applies only `20261010000001…`; status "up to date";
   history in order; stored checksum equals the file's SHA-256.

`migrate deploy` is **not** used for the hotfix: it would also apply `20261010000001`
before its code is released.

| Environment                  | How it gets the lockdown                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Ireland                      | Hotfix workflow above, after this PR is approved                                                                       |
| `production` branch          | Merge this PR into `main`, then bring it to `production` (only new files; no app code changes)                         |
| New US project (region move) | Restored from Ireland after the fix: gets the locked-down objects **and** the history row. Turn its Data API off first |
| Dev (`kesherio-dev`)         | `migrate deploy` when resumed; check `prisma migrate status`                                                           |

Don't edit the migration file after it is applied: `migrate resolve` records its checksum.

## Applying it to Ireland (after approval)

```bash
cd apps/api
U='…'   # Ireland DATABASE_URL (session pooler) from .env.prod.local
# 1. Snapshot of the current state (read-only)
bash prisma/security/dump-schema.sh ../../.env.prod.local ~/sec/ireland-before.sql
psql "$U" -X -A -t -f prisma/security/security-report.sql > ~/sec/report-before.txt
# 2. Apply + record
/opt/homebrew/opt/postgresql@17/bin/psql "$U" -X --single-transaction -v ON_ERROR_STOP=1 \
  -f prisma/migrations/20261008000000_lock_down_public_schema/migration.sql
DATABASE_URL="$U" npx prisma migrate resolve --applied 20261008000000_lock_down_public_schema
DATABASE_URL="$U" npx prisma migrate status   # pending: only 20261010000001
```

`prisma.config.ts` loads `apps/api/.env` (dev) — always pass Ireland's `DATABASE_URL`
explicitly.

## Post-deployment verification checklist

Right after applying (Ireland):

- [ ] `prisma migrate status`: only `20261010000001_client_tax_identity_and_import` pending
- [ ] `SECURITY_TEST_READ_ONLY=1 SECURITY_DATABASE_URL="$U" … public-schema-lockdown`: all
      database checks pass (write checks skipped)
- [ ] `DATA_API_URL=… DATA_API_ANON_KEY=… … public-schema-lockdown`: all HTTP checks pass
- [ ] `security-report.sql` again: every table `rls=true anon=- authenticated=-`; helpers
      `anon_x=false authenticated_x=false public_x=false`; no `anon`/`authenticated` in
      `postgres` default privileges
- [ ] Railway API health check green; no new errors in Railway logs or Sentry
- [ ] Lab portal: sign in, orders queue, open an order, enter and release a result,
      download the PDF, client list, settings
- [ ] Clinic app: sign in, create a case and order, view a released result, clinic
      settings (logo upload)
- [ ] Onboarding: open an invitation link and complete it (test clinic)
- [ ] RAG / AI interpretation on a case (uses `knowledge_chunks` and pgvector)
- [ ] Supabase dashboard → Advisors → Security: no "RLS disabled" findings
- [ ] Note the date in this file

## Rollback

`apps/api/prisma/security/rollback-lock-down-public-schema.sql` restores exactly the
pre-lockdown state (tested: the security report matches Ireland's current one). It
reopens the exposure, so use it only if something breaks that can't be fixed forward
quickly, keep the Data API off meanwhile, and fix forward with a new migration. Don't
remove the history row by hand.
