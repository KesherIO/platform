# Region move — switch-day runbook

Companion to `REGION_MIGRATION_PLAN.md` (decisions, rehearsal, details). This file is
what to follow on the day. Times are relative to **T0 = start of the freeze**.

## 1. Readiness (checked 2026-10-12)

### Security lockdown — applied in Ireland, carried to US

- Ireland: Data API off (REST/GraphQL 503) and migration
  `20261008000000_lock_down_public_schema` applied 2026-10-12 16:17 UTC; read-only
  security tests 12/12, HTTP check 21/21, 45/45 tables RLS on with no `anon` /
  `authenticated` access (`docs/SECURITY_LOCKDOWN.md`, Status).
- US (`kesherio-prod-us`, `vkraygviitfzgmrhbexd`): Data API off (503). In the rehearsal
  the restored copy passed the same tests (12/12, 21/21) and its security report was
  identical to Ireland's — the dump carries the grants, RLS, policies and default
  privileges; `pre-restore.sql` stops the new project's own default grants from being
  added on top.
- On the day the same checks run on US before reopening (section 4, T0+10).

### What the move copies — evidence from the rehearsal

| Data                                          | How                                       | Rehearsal result                                               | Checked again on the day                                  |
| --------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| Database records (public, app_private)        | `run-dump.sh` → `restore.sh`              | row counts identical on every table                            | `compare-data.mjs`: **row by row**, must be 0 differences |
| Auth users                                    | same dump (`auth` schema data)            | 26/26 users with password hashes, 26 identities                | `compare-data.mjs` (auth tables) + a real sign-in         |
| Storage metadata                              | same dump (`storage` schema data)         | 4 buckets, 66 object rows                                      | `compare-data.mjs` (bucket, path, size)                   |
| Storage files                                 | `copy-storage.mjs`                        | 66 files, 12.6 MB, 0 missing or different size                 | script's own re-list check                                |
| Permissions (grants, RLS, policies, defaults) | dump + `pre-restore.sql`                  | `inspect.sh` diff identical                                    | `inspect.sh` diff + security tests                        |
| Prisma migration history                      | same dump (`_prisma_migrations`)          | `migrate status`: up to date                                   | `prisma migrate status`                                   |
| Stored URLs with the old ref                  | step 4 `UPDATE`s                          | 3 + 27 rows rewritten; logo served by the new project          | `inspect.sh` "old ref" section empty                      |
| Not in the dump                               | Auth settings, JWT keys, Data API setting | set by hand in US (done); ES256 key, same public Auth settings | Auth settings endpoint + JWKS                             |

`compare-data.mjs` (new): compares both projects table by table on primary key + row
hash (read-only on both). Ireland vs Ireland: 78 tables, no differences — the check is
consistent. After the restore it must report **no differences** before anything is
switched.

### Backup of Ireland

There is **no Supabase backup** of Ireland (free plan). The rehearsal dump (2026-10-12
19:54, proven restorable) is kept as the backup in
`~/region-move/backups/ireland-2026-10-12T1954/` (`chmod 700`, `SHA256SUMS`, README).
Delete it only when a Supabase backup exists (Pro daily backup of Ireland, or of US
after the switch). The switch day takes its own fresh dump; no step uses this one.

## 2. Configuration changes (prepared, not applied)

| Where                                                      | What changes                                                                                                                                          | Value source                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Railway → `api` → Variables                                | `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` if set there — the API doesn't read them) | `.env.prod-us.local`                |
| Railway → `api` → Settings → Regions                       | `sfo` → **`iad`** (US East)                                                                                                                           | —                                   |
| Vercel → lab project → Env Variables                       | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` → then **Redeploy** (Vite reads them at build time)                                                     | `.env.prod-us.local` URL + anon key |
| `apps/frontend/src/environments/environment.production.ts` | `supabaseUrl`, `supabaseAnonKey`                                                                                                                      | `.env.prod-us.local` URL + anon key |
| `apps/frontend/ngsw-config.json`                           | `dataGroups[supabase-auth].urls`: `https://mqwurrtupumsizsvurpx.supabase.co/**` → the US URL (service worker must not treat Auth calls as app assets) | US URL                              |
| Local `.env.prod.local` files (root, `apps/lab`)           | point at US after the switch (keep the Ireland ones as `.env.prod-ireland.local`)                                                                     | —                                   |

Unchanged: Railway's public domain (`vet-ai-production.up.railway.app`, both
`vercel.json` rewrites), `INTERNAL_API_KEY`\*, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
VAPID keys, Sentry, `FRONTEND_URL` / `LAB_URL`. The API builds its JWT issuer and JWKS
URL from `SUPABASE_URL`; no code change.

\* `.env.prod-us.local` has a different `INTERNAL_API_KEY` from Ireland's. Decide before
the day: keep Railway's current value (callers of `/onboarding/lab-link` etc. keep
working) unless you intend to rotate it.

**The Angular change goes on its own branch/PR (`chore/switch-supabase-us-east`),
prepared before the day and merged only at T0+15.** Don't merge it earlier: the scripts'
guards read `environment.production.ts` to know which project is live, so with it merged
`copy-storage.mjs` would refuse to write to US. Run the day's scripts from a checkout
that still has the Ireland value (e.g. `feat/region-move-us-east`).

## 3. Before the day

- [ ] Window agreed with Biomet (45 min); who tells them to stop and to resume
- [ ] Supabase Pro on the organization (US is not paused for inactivity; daily backups)
- [ ] US: Data API off; Auth settings match Ireland (Site URL, redirect URLs, email
      templates, SMTP, rate limits, JWT expiry); ES256 key — verify on the day too
- [ ] `kesherio-prod-us` empty: `reset-target.mjs … ` dry run shows 0 everywhere
- [ ] PR `chore/switch-supabase-us-east` ready (not merged)
- [ ] Tools on the migration Mac: PostgreSQL 17 client, Node 22, both env files; one
      dry run of `run-dump.sh` the day before is **not** needed (rehearsed)
- [ ] Access ready: Supabase (both projects), Railway, Vercel, GitHub
- [ ] `INTERNAL_API_KEY` decision made
- [ ] Optional: switch day early in Biomet's day, so there is time to roll back

## 4. Timeline

| Time      | Who        | Step                                                                                                                                                                             |
| --------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T−30 min  | you        | Remind Biomet: stop at T0, sign out, expect to sign in again                                                                                                                     |
| **T−5**   | **Biomet** | **Last moment to enter data.** Finish and save anything in progress                                                                                                              |
| **T0**    | you        | **Freeze starts.** Ireland Auth: turn off sign-ups. Railway: stop the `api` service (no API = no writes)                                                                         |
| T0+1      | me         | `ALLOW_IRELAND=yes run-dump.sh .env.prod.local ~/region-move/dumps/cutover` (~1 min)                                                                                             |
| T0+2      | me         | `reset-target.mjs` dry run (must be empty) → `restore.sh` into US (~2 min)                                                                                                       |
| T0+5      | me         | `copy-storage.mjs --confirm` (~1 min) → URL `UPDATE`s (step 4 of the plan)                                                                                                       |
| T0+7      | me         | **Gate 1**: `compare-data.mjs` Ireland vs US → **0 differences**; `inspect.sh` diff = only `vector`; security tests on US 12/12 + HTTP 21/21; `prisma migrate status` up to date |
| T0+10     | you        | Railway variables → US values; region → `iad`; start the service (redeploys)                                                                                                     |
| T0+12     | you        | Vercel lab env vars → US; redeploy                                                                                                                                               |
| T0+15     | you        | Merge `chore/switch-supabase-us-east` → `main` → `production`; Vercel deploys the clinic app                                                                                     |
| T0+25     | both       | **Gate 2** (section 5): health checks, sign-in with a real password in both apps, read/write flows                                                                               |
| **T0+40** | you        | **Freeze ends — Biomet may resume.** Tell them to reload the apps (or reopen the PWA) and sign in again                                                                          |
| T0+40 →   | you        | Ireland Auth sign-ups stay off; nothing points at Ireland any more                                                                                                               |

**Stop point**: T−5, before the dump starts. Anything entered after T0 would exist only in
Ireland and would not be copied.
**Resume point**: T0+40, only after Gate 2 passes. Writes from then on go to US.

Clients that keep an old tab or PWA open after T0+40 still talk to Ireland's Auth until
they reload: their sign-in gives an Ireland token that the API (now US) rejects (401). No
data can be written that way — the API is the only writer — but tell users to reload.

## 5. Gate 2 — checks before reopening

- [ ] `/api/health/live` and `/api/health/ready` 200; Railway shows region `iad`
- [ ] Lab: sign in with an existing Biomet account (existing password); orders queue;
      open an order; enter and release a result on a **test** order; PDF downloads
- [ ] Lab: clients list; a client's logo loads (from the US Storage URL)
- [ ] Clinic app: sign in; open a case; view a released result
- [ ] Railway logs and Sentry: no new errors
- [ ] Import one client in a test lab and read `durationMs` in the logs (closes Phase 4)
- [ ] Note the time Gate 2 passed = **cutover time** (used by the rollback plan)

## 6. Rollback — without losing data

**Rule: Ireland is never written to after T0**, except by a rollback. It stays as it was
at T0, so it is always a complete, consistent fallback for everything before T0.

| When                                          | What to do                                                                                                                                   | Data loss                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Before Gate 1 passes (copy problem)           | Start the `api` service on Railway again with the **old** variables; Ireland sign-ups back on. Fix, `reset-target.mjs` US, retry another day | none                            |
| Between Gate 1 and reopening (switch problem) | Put back the old Railway variables and region `sfo`, the old Vercel lab variables, revert the Angular merge; start the service               | none — nobody has written to US |
| After reopening, problem with a fix           | **Fix forward** (preferred)                                                                                                                  | none                            |
| After reopening, must go back to Ireland      | Freeze again → copy US-only changes back to Ireland (below) → switch config back → reopen                                                    | none                            |

Copying changes back after reopening (data is small, so this is a manual, verified step):

1. Freeze again (same T−5 / T0 steps, now on US).
2. `compare-data.mjs .env.prod.local .env.prod-us.local --ids` lists, per table, the
   primary keys of rows **only in US** (new), **changed**, and **only in Ireland**
   (deleted in US) since T0 — ids only.
3. Export exactly those rows from US and apply them to Ireland in one transaction
   (`\copy` of the listed ids; deletes for "only in Ireland"); Auth users created after
   the cutover are copied the same way (`auth.users` + `auth.identities`).
4. Files uploaded after the cutover: `copy-storage.mjs` with source US and target
   Ireland (allowed once `environment.production.ts` points at US).
5. `compare-data.mjs` again → **0 differences** → switch the configuration back.

Keep Ireland for at least 2 weeks after the switch. On the free plan it may pause after
a week without activity: that's fine for a fallback (restore it from the dashboard), but
take a final dump before deleting it.

## 7. After

- [ ] Biomet told; users re-sign in (expected)
- [ ] Pro daily backup visible for US → then delete
      `~/region-move/backups/ireland-2026-10-12T1954/` and `~/region-move/dumps/cutover`
- [ ] Update local `.env.prod.local` files; delete `.env.prod-us.local` copies once merged
- [ ] Mark the plan done; record timings
- [ ] After 2 weeks: final dump of Ireland, then delete the project
