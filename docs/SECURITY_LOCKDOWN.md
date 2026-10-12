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

- The migration ships to Ireland in the same release as the client import (see
  "Release steps").

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

| `migrate deploy` of both migrations on a copy of Ireland with its real history | applied in order; status up to date; 16 passed |

## Prisma migration history

Ireland has every migration up to `20261007000001` applied. `main` adds two:

| Migration                                       | What it does                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `20261008000000_lock_down_public_schema`        | This lockdown (grants and RLS only)                                                                                            |
| `20261010000001_client_tax_identity_and_import` | Client import + clinic tax fields: nullable columns and two indexes on `tenants` and `clinic_lab_connections`; no data changes |

**Decision (2026-10-12): one release.** Both migrations go to Ireland together with plain
`prisma migrate deploy`, which applies them in name order, and then `main` is merged into
`production` (client import #37–#38, Phase 3 tax fields #39, this lockdown #40). No
`migrate resolve`, no cherry-pick.

Rehearsed on a local copy of Ireland's schema **with Ireland's real `_prisma_migrations`
rows** (134 rows) and the migration files from `main`:

1. `prisma migrate status` → pending: `20261008000000…`, `20261010000001…`
2. `prisma migrate deploy` → applies `20261008000000…`, then `20261010000001…`
3. `prisma migrate status` → "Database schema is up to date!"
4. Security tests: 16 passed; `tenants` has `legalName`, `taxIdType`, `taxId`,
   `taxIdNormalized` for the new code.

**Order matters: migrations first, then the code.** Nothing in the deploy runs migrations
(`railway.toml` has no pre-deploy step), and the new code selects the tax columns, so it
fails if it goes live before `20261010000001`. The other way round is safe: both
migrations are harmless for the code running today (it never uses the Data API roles and
ignores the new columns), so the minutes between the migration and the deploy are fine.

| Environment                  | How it gets the lockdown                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Ireland                      | `migrate deploy` (below), then merge `main` → `production`                                                                     |
| New US project (region move) | Restored from Ireland after the release: gets both migrations' objects **and** their history rows. Turn its Data API off first |
| Dev (`kesherio-dev`)         | `migrate deploy` when resumed; check `prisma migrate status`                                                                   |

Don't edit an applied migration file: Prisma stores its checksum.

## Release steps (Ireland)

```bash
cd apps/api          # on an up-to-date main
U='…'                # Ireland DATABASE_URL (session pooler) from .env.prod.local
mkdir -p ~/sec && chmod 700 ~/sec

# 1. Before: snapshot (read-only)
bash prisma/security/dump-schema.sh ../../.env.prod.local ~/sec/ireland-before.sql
psql "$U" -X -A -t -f prisma/security/security-report.sql > ~/sec/report-before.txt
DATABASE_URL="$U" npx prisma migrate status   # pending: 20261008000000…, 20261010000001…

# 2. Migrations (both, in order)
DATABASE_URL="$U" npx prisma migrate deploy
DATABASE_URL="$U" npx prisma migrate status   # "Database schema is up to date!"
```

3. **Merge `main` into `production`** → Railway (API) and Vercel (clinic app, lab portal)
   deploy. The lab build needs the new `papaparse` / `exceljs` dependencies (already in
   `package.json`).
4. Run the post-deployment checklist.

`prisma.config.ts` loads `apps/api/.env` (dev): always pass Ireland's `DATABASE_URL`
explicitly. If step 2 fails, don't merge: fix it, or roll back (see Rollback) and keep
`production` as it is.

## Post-deployment verification checklist

**Database (right after step 2)**

- [ ] `prisma migrate status`: "Database schema is up to date!"
- [ ] `SECURITY_TEST_READ_ONLY=1 SECURITY_DATABASE_URL="$U" … public-schema-lockdown`: all
      database checks pass (write checks skipped)
- [ ] `DATA_API_URL=… DATA_API_ANON_KEY=… … public-schema-lockdown`: all HTTP checks pass
- [ ] `security-report.sql` again: every table `rls=true anon=- authenticated=-`; helpers
      `anon_x=false authenticated_x=false public_x=false`; no `anon`/`authenticated` in
      `postgres` default privileges
- [ ] Supabase dashboard → Advisors → Security: no "RLS disabled" findings

**Deploy (after step 3)**

- [ ] Railway: new deploy live, health check green, no new errors in logs or Sentry
- [ ] Vercel: clinic app and lab portal deployed from the new `production` commit

**Existing flows**

- [ ] Lab portal: sign in, orders queue, open an order, enter and release a result,
      download the PDF, client list and client detail, settings
- [ ] Clinic app: sign in, create a case and an order, view a released result, clinic
      settings (logo upload)
- [ ] Onboarding: open an invitation link and complete it (test clinic)
- [ ] RAG / AI interpretation on a case (uses `knowledge_chunks` and pgvector)

**New features in this release**

- [ ] Lab → Settings → Laboratory: country saves (default country for imports)
- [ ] Lab → Clients → Add client and edit: legal name, ID type (depends on country,
      includes Ecuador) and ID number save and show
- [ ] Lab → Clients → Import: a small CSV (2–3 test rows) → preview → import → rows
      created; importing the same file again → all "Already in your lab"
- [ ] Clinic onboarding for an imported client: legal name / ID type / ID number
      prefilled; changing the country clears an ID type that doesn't fit
- [ ] Clinic app → Settings → Clinic: legal name and ID shown and editable
- [ ] Delete the test clients and note the date in this file

## Rollback

- **A feature in the release breaks** (client import, tax fields): revert the merge on
  `production` and redeploy. Keep both migrations: they are harmless for the previous
  code.
- **The lockdown breaks something** that can't be fixed forward quickly:
  `apps/api/prisma/security/rollback-lock-down-public-schema.sql` (psql, one transaction)
  restores exactly the pre-lockdown grants and RLS (tested: the security report matches
  Ireland's before the release). It reopens the exposure, so keep the Data API off
  meanwhile and fix forward with a new migration. Don't remove the history row by hand.
- **`migrate deploy` fails**: Prisma marks that migration as failed and stops before the
  next one. Run `security-report.sql` (and check the columns for `20261010000001`) to see
  what was applied, finish or undo it by hand, then
  `prisma migrate resolve --rolled-back <name>` (or `--applied` if it is fully applied)
  and deploy again. Don't merge into `production` until status is "up to date".
