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

There is **no Supabase backup** of Ireland (Free plan; the Pro upgrade isn't possible yet,
so the move goes ahead on Free — decided 2026-10-12). Backups:

- **Fresh full dump** `~/region-move/backups/ireland-2026-10-12T2027/` (`chmod 700`,
  `SHA256SUMS`, README): row counts equal live Ireland on all 76 tables; content-identical
  to the rehearsal dump that restored into US with 0 errors (its log is kept there as
  proof). The rehearsal dump itself was deleted as redundant.
- **Ireland itself**: never written to after T0, kept ≥ 2 weeks.
- The switch day's own dump (`~/region-move/dumps/cutover`).

Free plan risks accepted: no automatic backups (only the dumps above), and a Free
project can be paused after ~7 days without activity — upgrade to Pro as soon as
Supabase allows; until then keep the production project in regular use.

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

**The Angular change is ready on its own branch: `chore/switch-supabase-us-east`
(commit `82e8f57`: only `environment.production.ts` and `ngsw-config.json`; the anon key
is the public `anon` JWT, no secrets). Merge it only at step T0+13.** Don't merge it earlier: the scripts'
guards read `environment.production.ts` to know which project is live, so with it merged
`copy-storage.mjs` would refuse to write to US. Run the day's scripts from a checkout
that still has the Ireland value (e.g. `feat/region-move-us-east`).

## 3. Before the day

- [x] Biomet off the application until told (confirmed 2026-10-12)
- [ ] Window agreed with Biomet (45 min); who tells them to resume
- [x] Pro upgrade: not possible yet — proceeding on Free (risks in "Backup of Ireland")
- [x] US: Data API off; ES256 key; public Auth settings equal Ireland's
- [ ] US: Auth settings not visible through the API match Ireland (Site URL, redirect
      URLs, email templates, SMTP, rate limits, JWT expiry) — checked by you in the
      dashboard
- [x] `kesherio-prod-us` empty (reset dry run 0, emptiness check 0, fresh baseline)
- [x] Switch PR `chore/switch-supabase-us-east` ready, **not merged**
- [x] Tools: PostgreSQL 17.11 client, Node 22, Supabase CLI 2.120.0, both env files
- [x] `INTERNAL_API_KEY`: unchanged in Railway (identical in both env files)
- [ ] Access ready: Supabase (both projects), Railway, Vercel, GitHub
- [ ] Fresh backup of Ireland taken right before (done 20:27; repeat if the cutover is
      on another day)

## 4. Timeline

| Time      | Who        | Step                                                                                                                                                                                                                                                                                           |
| --------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T−30 min  | you        | Remind Biomet: stay off until told; afterwards close every tab / the installed app, reopen and sign in again                                                                                                                                                                                   |
| **T−5**   | **Biomet** | **Last moment to enter data** (already confirmed off)                                                                                                                                                                                                                                          |
| **T0**    | you        | **Freeze.** Ireland → Authentication → Sign In / Providers → **Email off** (no sign-in or sign-up in Ireland from here on) · Railway → `api` → **stop**                                                                                                                                        |
| T0+1      | me         | Ireland write counters twice, 1 min apart → no change in `public` / `storage` (see Freeze scope)                                                                                                                                                                                               |
| T0+2      | me         | `run-dump.sh` Ireland → `~/region-move/dumps/cutover` (~45 s); dump row counts = live counts                                                                                                                                                                                                   |
| T0+3      | me         | `reset-target.mjs` dry run (0) → `restore.sh` into US (~2 min)                                                                                                                                                                                                                                 |
| T0+6      | me         | `copy-storage.mjs --confirm` (~40 s) → the 2 logo-URL `UPDATE`s                                                                                                                                                                                                                                |
| T0+8      | me         | **Gate 1**: `compare-data.mjs` Ireland vs US → **0 differences**; `inspect.sh` diff = only `vector`; security tests on US 12/12 + HTTP 21/21; `prisma migrate status` up to date                                                                                                               |
| T0+10     | you        | Railway `api` variables → US (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `INTERNAL_API_KEY` unchanged); region → `iad`; start → `/api/health/ready` 200                                                                                                                      |
| T0+12     | you        | Vercel lab project → `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → US (no manual redeploy: the next step triggers it)                                                                                                                                                                       |
| T0+13     | you        | Check `production..main` is empty → merge `chore/switch-supabase-us-east` into `main` → check `production..main` = **only that commit** → merge `main` into `production` → Vercel builds the clinic app and the lab (new variables); Railway redeploys the same API code with the US variables |
| T0+25     | both       | **Gate 2** (section 5)                                                                                                                                                                                                                                                                         |
| **T0+40** | you        | **Biomet may resume — only after Gate 2 passes, whenever that is** (time limits below)                                                                                                                                                                                                         |
| after     | you        | Ireland's Email provider stays **off**                                                                                                                                                                                                                                                         |

**Stop point**: T−5. **Resume point**: only after Gate 2 passes, about T0+40.

### Freeze scope: what can write to Ireland, and how each is stopped

Checked 2026-10-12 (public Auth settings, Ireland connections and extensions):

| Possible writer                                                       | Status in Ireland                                                               | Stopped by                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Users through the apps                                                | every write goes through the NestJS API (frontends only call `supabase.auth.*`) | Railway `api` stopped                                                                                                    |
| KesherIO / internal callers (`INTERNAL_API_KEY`)                      | call the same API                                                               | Railway `api` stopped                                                                                                    |
| Email + password, magic link / OTP, sign-up, password recovery        | the only Auth method enabled                                                    | Email provider **off**                                                                                                   |
| Phone, anonymous, social (Google, …), SAML/SSO, passkeys              | all **off**                                                                     | —                                                                                                                        |
| Data API (PostgREST, GraphQL)                                         | off (503); `anon` / `authenticated` have no privileges                          | already done                                                                                                             |
| Database webhooks, `pg_net`, `pg_cron` jobs, Realtime, Edge Functions | none installed / configured                                                     | —                                                                                                                        |
| Refresh of an existing browser session                                | 5 sessions on record, last refreshed 2026-10-08                                 | not stopped — but it only touches `auth.sessions` / `auth.refresh_tokens`, which are useless after the switch (new keys) |
| Scripts (`prisma/seeds`, region-move)                                 | run by hand only                                                                | not run during the freeze, except the migration                                                                          |

The T0+1 check therefore requires **no change in `public` and `storage`**; a change only in
`auth.sessions` / `auth.refresh_tokens` / `auth.audit_log_entries` is acceptable (a token
refresh) and is not a data loss.

### Time limits — Biomet stays offline until you say so

Biomet resumes **only** when you tell them, after Gate 2 passes — even if that's later
than T0+40. To keep the outage bounded:

| Limit               | If not reached                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gate 1 by **T0+30** | abort: Railway `api` started again with the old variables, Ireland Email provider on → Biomet resumes on Ireland (no data loss); `reset-target.mjs` US; retry another day |
| Gate 2 by **T0+75** | roll back the configuration (section 6, "between Gate 1 and reopening") → Biomet resumes on Ireland (no data loss; Gate 2 test writes discarded)                          |

Adjust the limits before the day if Biomet needs a different maximum outage.

### Rollback card (keep open during the cutover)

Before changing anything at T0+10/T0+12, **copy the current values** so they can be put
back exactly:

- Railway `api` → Variables → Raw Editor → copy everything into a local file
  (`~/region-move/railway-vars-before.txt`, `chmod 600`); note the region (`sfo`)
- Vercel lab project → Environment Variables: note `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` (Production). They match `apps/lab/.env.prod.local` (checked)
- Clinic app: revert the switch commit on `main` and `production` (one commit)
- Ireland: Email provider back on

### Merge sequence without releasing unrelated code

`main` and `production` are identical today (`22da7ef`). Until the cutover, merge nothing
else into `main`. At T0+13 merge **only** `chore/switch-supabase-us-east` into `main`,
confirm `git log origin/production..origin/main` lists exactly that one commit (`Point the
clinic app at the US East Supabase project`), then merge `main` into `production`. The
other open branches (`docs/security-lockdown-released`, `chore/delete-imported-clients-script`,
`feat/region-move-us-east`) stay unmerged until after the cutover: they're docs and
scripts only, but keeping them out makes the release exactly one known change.

### No real user writes to US before Gate 2

| Until         | Why nobody else can write to US                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0+10         | Nothing points at US: the API is stopped, both frontends use Ireland                                                                                                                                                                     |
| T0+13         | The API trusts only US tokens. Every frontend still signs in at Ireland, where the Email provider is off, so nobody can get a token the API accepts; existing Ireland tokens are rejected (401)                                          |
| end of Gate 2 | The new frontends sign in at US. Prevention is the freeze (Biomet confirmed off); **detection**: before reopening, `compare-data.mjs --ids` lists every row that differs from Ireland, and it must contain only Gate 2's own test writes |

### Service worker: clients don't stay on Ireland

- **Clinic app (Angular PWA)**: the Supabase URL is compiled into the bundle, and
  `ngsw-worker.js` serves the cached version first (`registerWhenStable:30000`; the app
  has no `SwUpdate` handling). A tab or installed app that stays open across the switch
  keeps the old (Ireland) version until a load **after** the new version has downloaded —
  usually the second load. On the old version it can't sign in (Ireland Email provider
  off) and can't write (the API rejects Ireland tokens): it fails closed, and nothing can
  reach Ireland's data through it. "Close every tab / the installed app, reopen, sign in"
  is enough. Optional follow-up (separate PR, not needed for the cutover): reload on
  `SwUpdate.versionUpdates` `VERSION_READY`.
- **Lab portal**: no caching service worker (`/sw.js` only handles push notifications);
  a reload loads the new build.
- The `supabase-auth` data group (`freshness`, `maxSize: 0`) never serves Auth calls from
  cache, before or after the switch.

## 5. Gate 2 — checks before reopening

Reads, plus two small test writes that are undone or harmless. Don't create orders or
release results for the test: releases and their PDFs are permanent records.

- [ ] `/api/health/live` and `/api/health/ready` 200; Railway shows region `iad`
- [ ] Lab (fresh tab): sign in with an existing account and its **existing password**
      (Auth copy works); orders queue; open an order; open a released result and download
      its PDF (Storage copy works)
- [ ] Lab: clients list; a client logo loads from the US Storage URL
- [ ] Clinic app (fresh tab, after the new version loaded): sign in; open a case; view a
      released result
- [ ] **Test write 1**: Lab → Clients → Import 2 test rows (emails
      `zz-cutover-1@example.com`, `zz-cutover-2@example.com`) → read `durationMs` in the
      Railway logs (closes Phase 4) → delete both clients (Delete client)
- [ ] **Test write 2**: Lab → Settings → Laboratory → save without changes
- [ ] Railway logs and Sentry: no new errors
- [ ] `compare-data.mjs .env.prod.local .env.prod-us.local --ids` → only expected rows:
      Auth sessions / refresh tokens / audit entries / `last_sign_in_at` of the test
      sign-ins, and `updatedAt` of the laboratory row. **Anything else is a real write:
      stop and look before reopening**
- [ ] Save that output as the cutover record (`~/region-move/cutover-record.txt`); note
      the time = **cutover time**

**Test import cleanup** (checked in `lab-clients.service.ts`): an import row creates
exactly one `tenants` row (CLINIC) and one `clinic_lab_connections` row — no users, no
onboarding token (`withInvitation: false`), no counter or timeline rows. **Delete
client** deletes both (connection, then tenant; it would also revoke tokens, of which
there are none). `compare-data.mjs` after the deletion must show **no** `public`
differences from the import; if it lists any `tenants` / `clinic_lab_connections` id,
the cleanup didn't finish — delete that client before reopening.

## 6. Rollback — without losing data

**Rule: Ireland is never written to after T0**, except by a rollback. It stays as it was
at T0, so it is always a complete, consistent fallback for everything before T0.

| When                                          | What to do                                                                                                                                                             | Data loss                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Before Gate 1 passes (copy problem)           | Start the `api` service on Railway again with the **old** variables; Ireland Email provider back on. Fix, `reset-target.mjs` US, retry another day                     | none                                                                |
| Between Gate 1 and reopening (switch problem) | Put back the old Railway variables and region `sfo`, the old Vercel lab variables, revert the Angular merge on `main` and `production`; Ireland Email provider back on | none — only Gate 2's test writes exist in US, and they're discarded |
| After reopening, problem with a fix           | **Fix forward** (preferred)                                                                                                                                            | none                                                                |
| After reopening, must go back to Ireland      | Freeze again → copy US-only changes back to Ireland (below) → switch config back → reopen                                                                              | none                                                                |

**Gate 2's test writes in a rollback**: the 2 test clients are deleted before reopening,
and the remaining differences are test sign-in sessions and one `updatedAt` — none of it
is copied back. If a rollback happens before the test clients were deleted, they simply
don't exist in Ireland: discard them with US. The saved `compare-data` record from Gate 2
is the reference: in a later rollback, rows listed there are test writes and are skipped.

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
