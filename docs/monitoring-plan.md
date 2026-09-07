# KesherIO — Production Monitoring Plan (Revised)

**Date**: 2026-09-07  
**Deadline**: Wednesday 2026-09-09 (final day reserved for deployment verification + fixing)  
**Context**: First testing round, then two-week travel. Must capture errors, health, and usage data without active supervision.

---

## Investigation Summary

### What exists today

| Area | Status | Details |
|------|--------|---------|
| Error tracking | None | No Sentry, no error boundaries, no global exception filter |
| Request logging | None | No interceptors; only scattered `console.error`/`Logger.log` |
| Health endpoints | Basic | `GET /api` → `{ message: "Hello API" }` (public); `GET /api/auth/health` → `{ status: "ok" }` — neither checks DB |
| Audit trail | **Excellent** | `TimelineEvent` (31 event types, table `timeline_events`); `VetVerificationEvent` (table `vet_verification_events`); `ResultReportRelease` (immutable release snapshots, table `result_report_releases`) |
| Analytics | None | No PostHog, GA, Mixpanel, or Segment |
| Structured logging | None | NestJS built-in Logger only, no JSON, no request IDs |
| Source maps | Enabled | API: Webpack `sourceMap: true`; Frontend: Angular `sourceMap: true` (dev config); Lab: Vite defaults |
| Error boundaries | None | Angular: no custom `ErrorHandler`; React: no `ErrorBoundary` |

### Deployed apps

| App | Framework | Deploy target | Config |
|-----|-----------|---------------|--------|
| `frontend` (clinic) | Angular 21 | Vercel (static SPA) | `vercel.json` at repo root; rewrites `/api/*` → `vet-ai-production.up.railway.app` |
| `lab` | React 19 + Vite | Vercel (static SPA) | `apps/lab/vercel.json`; same Railway rewrite |
| `api` | NestJS 11 | Railway (Dockerfile → `node dist/main.js`) | `railway.toml`; multi-stage Docker build; port 3000 |

### Existing audit coverage — what's already tracked

| Workflow event | Existing coverage | Table / column |
|----------------|-------------------|----------------|
| Case created | `cases.created_at`, `cases.created_by_user_id`, `cases.tenant_id` | `cases` |
| Order submitted | `TimelineEventType.ORDER_CREATED` + `orders.created_at` | `timeline_events`, `orders` |
| Pickup requested | `TimelineEventType.PICKUP_REQUESTED` | `timeline_events` |
| Specimen received | `TimelineEventType.RECEIVED_AT_LAB`, `SAMPLE_ACCESSIONED`, `SAMPLE_ACCEPTED` + `specimens.received_at` | `timeline_events`, `specimens` |
| Results saved | `TimelineEventType.RESULTS_COMPLETED` | `timeline_events` |
| Submitted for review | `TimelineEventType.SUBMITTED_FOR_REVIEW` | `timeline_events` |
| Results released | `TimelineEventType.RELEASE_CREATED`, `REPORT_RELEASED` + `result_report_releases.released_at` | `timeline_events`, `result_report_releases` |
| User activity | `timeline_events.actor_id` across all event types | `timeline_events` |

**Not tracked and NOT adding now**:
- `user_logged_in` — login is client-side Supabase; API has no login endpoint
- `ai_triage_completed` — triage feature not implemented yet
- `workflow_failed` — deferred; no `AuditEvent` model in this change

---

## Decisions You Must Make Manually

### Before implementation

1. **Create three Sentry projects** at [sentry.io](https://sentry.io):
   - `kesherio-clinic` (JavaScript / Angular platform)
   - `kesherio-lab` (JavaScript / React platform)
   - `kesherio-api` (Node.js / Express platform — Sentry NestJS uses Express under the hood)
   - Copy each project's DSN

2. **Sentry auth token** for source-map uploads:
   - Create at Organization Settings → Developer Settings → Auth Tokens
   - Scope: `project:releases`, `org:read`
   - Needed only for API source maps (uploaded during Docker build); frontend source maps are handled differently (see Phase 2)

3. **Sentry org slug** — the organization name in your Sentry URL (e.g., `kesherio`)

### Environment variables to set

#### Railway (API service)
| Variable | Value | Notes |
|----------|-------|-------|
| `SENTRY_DSN` | DSN from `kesherio-api` project | Sentry disabled when empty |
| `SENTRY_ENVIRONMENT` | `production` | |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | 10% of requests traced |
| `SENTRY_AUTH_TOKEN` | Auth token from step 2 | For source-map upload in Docker build |
| `SENTRY_ORG` | Your Sentry org slug | For source-map upload |
| `SENTRY_PROJECT` | `kesherio-api` | For source-map upload |

> Railway auto-provides `RAILWAY_GIT_COMMIT_SHA` — used as Sentry release identifier.

#### Vercel — clinic (`frontend`) project
| Variable | Value | Notes |
|----------|-------|-------|
| `NG_APP_SENTRY_DSN` | DSN from `kesherio-clinic` project | Injected at build time |
| `SENTRY_AUTH_TOKEN` | Same auth token | For source-map upload |
| `SENTRY_ORG` | Your Sentry org slug | |
| `SENTRY_PROJECT` | `kesherio-clinic` | |

> Angular uses environment file replacement at build time. We'll read `NG_APP_SENTRY_DSN` in `environment.production.ts` via a build-time substitution approach — details in Phase 2.

#### Vercel — lab project
| Variable | Value | Notes |
|----------|-------|-------|
| `VITE_SENTRY_DSN` | DSN from `kesherio-lab` project | Vite auto-exposes `VITE_*` to client |
| `SENTRY_AUTH_TOKEN` | Same auth token | For source-map upload |
| `SENTRY_ORG` | Your Sentry org slug | |
| `SENTRY_PROJECT` | `kesherio-lab` | |

---

## Implementation Plan

### Day 1 (Mon 2026-09-08): Core implementation

#### Phase 1: Sentry integration (~2.5h)

**Dependencies to install:**
```bash
npm install @sentry/nestjs @sentry/node @sentry/cli    # API + CLI for source maps
npm install @sentry/angular                              # Clinic frontend
npm install @sentry/react @sentry/vite-plugin            # Lab
npm install @nestjs/terminus                             # Health checks (Phase 3)
```

**1a. API Sentry — `apps/api/src/`**

| File | Action | Details |
|------|--------|---------|
| `instrument.ts` | **Create** | `Sentry.init()` — loads before everything; reads `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, `RAILWAY_GIT_COMMIT_SHA` from `process.env`; includes `beforeSend` sanitizer |
| `main.ts` | **Edit** | Add `import './instrument';` as the very first line |
| `app/app.module.ts` | **Edit** | Add `SentryModule.forRoot()` to imports |
| `common/filters/sentry-exception.filter.ts` | **Create** | Global exception filter: captures to Sentry with `requestId`/`userId`/`tenantId`/`role` context; skips 401/403/404; strips sensitive data |

**`beforeSend` sanitizer rules:**
- Remove `request.data` (body) — never send request bodies
- Remove `request.cookies`
- Strip headers: `authorization`, `cookie`, `x-internal-api-key`, `x-tenant-id`
- Redact any breadcrumb/tag/extra value matching: `email`, `phone`, `address`, `token`, `password`, `secret`, `key`, `credential`
- Drop events where `statusCode` is 401, 403, or 404 (expected auth/routing failures)

**1b. Clinic frontend — `apps/frontend/src/`**

| File | Action | Details |
|------|--------|---------|
| `environments/environment.ts` | **Edit** | Add `sentryDsn: ''` |
| `environments/environment.production.ts` | **Edit** | Add `sentryDsn: process.env['NG_APP_SENTRY_DSN'] ?? ''` — Angular 21 supports build-time env substitution via the `application` builder |
| `main.ts` | **Edit** | Conditional `Sentry.init()` before `bootstrapApplication` when `environment.sentryDsn` is truthy |
| `app/app.config.ts` | **Edit** | Add `Sentry.createErrorHandler()` and `Sentry.TraceService` providers (conditional on DSN) |

**Frontend `beforeSend`:** Same PII rules as API — strip URL query params containing `token`, `code`, `email`; never send breadcrumb data containing clinical terms.

**1c. Lab — `apps/lab/src/`**

| File | Action | Details |
|------|--------|---------|
| `sentry.ts` | **Create** | `Sentry.init()` with `import.meta.env.VITE_SENTRY_DSN`; `beforeSend` sanitizer; `VITE_SENTRY_ENVIRONMENT` or default `production` |
| `main.tsx` | **Edit** | Add `import './sentry';` as first line |
| `app/app.tsx` | **Edit** | Wrap root `<ToastProvider>` tree in `<Sentry.ErrorBoundary fallback={<ErrorFallback />}>` |
| `app/shared/components/ErrorFallback.tsx` | **Create** | Minimal "Something went wrong, please reload" component |

**1d. Environment files**

| File | Action |
|------|--------|
| `.env.example` | **Edit** — add Sentry API vars |
| `apps/lab/.env.example` | **Edit** — add `VITE_SENTRY_DSN` |

---

#### Phase 2: Source-map uploads (~1h)

**API (Railway/Docker)**:
- Add `@sentry/cli` upload step to `Dockerfile` after the build stage
- Upload source maps with the release set to `RAILWAY_GIT_COMMIT_SHA`
- Delete `.map` files from the runtime image so they're never served

| File | Action |
|------|--------|
| `Dockerfile` | **Edit** — add sentry-cli source-map upload + delete .map files |

**Lab (Vite/Vercel)**:
- Add `@sentry/vite-plugin` to `vite.config.ts` — it automatically uploads source maps during `vite build` and strips them from the output
- Requires `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` env vars (set in Vercel)

| File | Action |
|------|--------|
| `apps/lab/vite.config.ts` | **Edit** — add `sentryVitePlugin()` |

**Clinic (Angular/Vercel)**:
- Angular 21 with the `application` builder generates source maps only in dev by default (production config has no explicit `sourceMap: true`)
- For the pilot, we will **not** upload clinic source maps to Sentry — Angular's esbuild output doesn't integrate with `@sentry/cli` as cleanly, and Sentry still captures error messages, stack traces, and user context without mapped stacks
- Post-pilot improvement: add `@sentry/angular` source-map upload via a Vercel build script

---

#### Phase 3: Request IDs & Structured Logging (~1.5h)

| File | Action | Details |
|------|--------|---------|
| `apps/api/src/common/middleware/request-id.middleware.ts` | **Create** | Reads incoming `x-request-id` (validates UUID format), or generates `crypto.randomUUID()`; sets on `req.requestId`; writes `x-request-id` response header; sets Sentry tag |
| `apps/api/src/common/interceptors/logging.interceptor.ts` | **Create** | One JSON log line per request to stdout |
| `apps/api/src/main.ts` | **Edit** | Apply request-id middleware globally via `app.use()` |
| `apps/api/src/app/app.module.ts` | **Edit** | Register `LoggingInterceptor` via `APP_INTERCEPTOR` |

**Structured log format** (one line per completed request):
```json
{
  "level": "info",
  "message": "HTTP GET /api/orders 200 45ms",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "GET",
  "route": "/api/orders",
  "statusCode": 200,
  "durationMs": 45,
  "userId": "abc123",
  "tenantId": "tenant456",
  "role": "VET",
  "environment": "production",
  "timestamp": "2026-09-08T15:30:00.000Z"
}
```

**Rules**:
- stdout only (Railway captures automatically)
- Never log: request bodies, response bodies, `authorization` headers, cookies, tokens, patient/owner data
- Suppress: `GET /api/health/live` and `GET /api/health/ready` when 2xx (reduce noise)
- Error requests (4xx/5xx): `level: "warn"` for 4xx, `level: "error"` for 5xx; include error message (not stack trace)
- `userId`, `tenantId`, `role` extracted from the JWT-decoded request user (set by `JwtAuthGuard`)

---

#### Phase 4: Health Endpoints (~30min)

| File | Action |
|------|--------|
| `apps/api/src/health/health.module.ts` | **Create** |
| `apps/api/src/health/health.controller.ts` | **Create** |
| `apps/api/src/health/prisma-health.indicator.ts` | **Create** — runs `SELECT 1` via `PrismaService.$queryRawUnsafe('SELECT 1')` |
| `apps/api/src/app/app.module.ts` | **Edit** — import `HealthModule` |

| Route | Auth | Checks | Success | Failure |
|-------|------|--------|---------|---------|
| `GET /api/health/live` | `@Public()` | None (process is up) | `200 { status: "ok" }` | N/A (if process is down, no response) |
| `GET /api/health/ready` | `@Public()` | DB reachable (`SELECT 1`) | `200 { status: "ok" }` | `503 { status: "error" }` |

**Rules**:
- No auth required
- No database URLs, versions, env vars, stack traces, or internal config in response
- Excluded from Sentry tracing (via `ignoreTransactions` in `instrument.ts`)
- Excluded from request logging when 2xx

---

### Day 1 (evening): Verification round 1

- Run lint, test, build for all three apps
- Verify graceful degradation with no Sentry DSN
- Verify 401/403 do not trigger Sentry events
- Verify health endpoints reveal nothing sensitive

---

### Day 2 (Tue 2026-09-09): Tests, queries, docs, deployment

#### Phase 5: Automated Tests (~1.5h)

| File | Tests |
|------|-------|
| `apps/api/src/common/middleware/request-id.middleware.spec.ts` | Generates UUID when no header; passes through valid UUID; rejects invalid format and generates new; returns in response header |
| `apps/api/src/common/interceptors/logging.interceptor.spec.ts` | Emits structured JSON to stdout; skips health paths; includes requestId; does not log request bodies |
| `apps/api/src/common/filters/sentry-exception.filter.spec.ts` | Strips authorization header; skips 401/403/404; attaches requestId + userId + tenantId to Sentry scope |
| `apps/api/src/health/health.controller.spec.ts` | Liveness returns 200; readiness returns 200 when DB connected; readiness returns 503 when DB unreachable |

---

#### Phase 6: Verified Operational Reporting Queries

All queries verified against the actual Prisma schema table/column mappings.

**Schema reference for queries** (Prisma `@@map` → PostgreSQL table names):
- `Case` → `cases` — columns: `id`, `tenant_id`, `status` (CaseStatus enum), `created_by_user_id`, `created_at`
- `Order` → `orders` — columns: `id`, `tenant_id`, `lab_tenant_id`, `status` (OrderStatus enum), `created_at`, `received_by_lab_at`, `completed_at`, `cancelled_at`
- `TimelineEvent` → `timeline_events` — columns: `id`, `order_id`, `event_type` (TimelineEventType enum), `actor_id`, `actor_name`, `created_at`
- `ResultReportRelease` → `result_report_releases` — columns: `id`, `report_id`, `release_type` (ReleaseType enum), `released_at`, `released_by_user_id`, `order_id`, `lab_tenant_id`, `clinic_tenant_id`
- `ResultReport` → `result_reports` — columns: `id`, `order_id`, `case_id`, `tenant_id`, `status` (ResultReportStatus enum), `released_at`
- `Specimen` → `specimens` — columns: `id`, `order_id`, `lab_tenant_id`, `status` (SpecimenStatus enum), `received_at`
- `OrderedTest` → `ordered_tests` — columns: `id`, `order_id`, `status` (OrderedTestStatus enum), `started_at`, `completed_at`
- `User` → `users` — columns: `id`, `email`, `first_name`, `last_name`
- `UserTenantMembership` → `user_tenant_memberships` — columns: `user_id`, `tenant_id`, `role` (TenantRole enum)
- `Tenant` → `tenants` — columns: `id`, `name`, `type` (TenantType enum)

**Enum values used in queries:**
- `OrderStatus`: `PENDING`, `READY_FOR_PICKUP`, `COLLECTED`, `RECEIVED_BY_LAB`, `PROCESSING`, `COMPLETED`, `CANCELLED`
- `CaseStatus`: `OPEN`, `TRIAGED`, `ORDERED`, `COMPLETED`, `CANCELLED`
- `SpecimenStatus`: `EXPECTED`, `RECEIVED`, `ACCEPTED`, `REJECTED`, `MISSING`
- `OrderedTestStatus`: `PENDING`, `READY`, `IN_PROGRESS`, `RESULTS_ENTERED`, `IN_REVIEW`, `COMPLETED`, `BLOCKED`, `CANCELLED`
- `ReleaseType`: `PARTIAL`, `FINAL`, `AMENDMENT`
- `TimelineEventType`: 31 values (see schema)

```sql
-- ─────────────────────────────────────────────────────────────
-- 1. Daily active users (distinct actors in timeline_events)
-- ─────────────────────────────────────────────────────────────
SELECT
  DATE(te.created_at) AS day,
  COUNT(DISTINCT te.actor_id) AS active_users
FROM timeline_events te
WHERE te.actor_id IS NOT NULL
  AND te.created_at >= NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day;

-- ─────────────────────────────────────────────────────────────
-- 2. Cases created per tenant per day
-- ─────────────────────────────────────────────────────────────
SELECT
  DATE(c.created_at) AS day,
  c.tenant_id,
  t.name AS tenant_name,
  COUNT(*) AS cases_created
FROM cases c
JOIN tenants t ON c.tenant_id = t.id
WHERE c.created_at >= NOW() - INTERVAL '30 days'
GROUP BY day, c.tenant_id, t.name
ORDER BY day, t.name;

-- ─────────────────────────────────────────────────────────────
-- 3. Orders created per tenant per day
-- ─────────────────────────────────────────────────────────────
SELECT
  DATE(o.created_at) AS day,
  o.tenant_id,
  t.name AS tenant_name,
  COUNT(*) AS orders_created
FROM orders o
JOIN tenants t ON o.tenant_id = t.id
WHERE o.created_at >= NOW() - INTERVAL '30 days'
GROUP BY day, o.tenant_id, t.name
ORDER BY day, t.name;

-- ─────────────────────────────────────────────────────────────
-- 4. Results released per day (from immutable release snapshots)
-- ─────────────────────────────────────────────────────────────
SELECT
  DATE(rr.released_at) AS day,
  rr.lab_tenant_id,
  COUNT(*) AS releases,
  COUNT(*) FILTER (WHERE rr.release_type = 'FINAL') AS final_releases,
  COUNT(*) FILTER (WHERE rr.release_type = 'PARTIAL') AS partial_releases,
  COUNT(*) FILTER (WHERE rr.release_type = 'AMENDMENT') AS amendments
FROM result_report_releases rr
WHERE rr.released_at >= NOW() - INTERVAL '30 days'
GROUP BY day, rr.lab_tenant_id
ORDER BY day;

-- ─────────────────────────────────────────────────────────────
-- 5. Orders stuck in non-terminal status (>48h old)
--    Terminal statuses: COMPLETED, CANCELLED
-- ─────────────────────────────────────────────────────────────
SELECT
  o.id,
  o.requisition_number,
  o.status,
  o.tenant_id,
  t.name AS clinic_name,
  o.created_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 3600, 1) AS hours_open
FROM orders o
JOIN tenants t ON o.tenant_id = t.id
WHERE o.status NOT IN ('COMPLETED', 'CANCELLED')
  AND o.created_at < NOW() - INTERVAL '48 hours'
ORDER BY o.created_at;

-- ─────────────────────────────────────────────────────────────
-- 6. Specimens stuck in non-terminal status
--    Terminal: ACCEPTED, REJECTED
--    Stuck candidates: EXPECTED (never arrived), RECEIVED (never accepted/rejected), MISSING
-- ─────────────────────────────────────────────────────────────
SELECT
  s.id,
  s.accession_number,
  s.status,
  s.specimen_type,
  s.lab_tenant_id,
  s.order_id,
  o.requisition_number,
  s.created_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - s.created_at)) / 3600, 1) AS hours_since_created
FROM specimens s
JOIN orders o ON s.order_id = o.id
WHERE s.status IN ('EXPECTED', 'RECEIVED', 'MISSING')
  AND s.created_at < NOW() - INTERVAL '24 hours'
ORDER BY s.created_at;

-- ─────────────────────────────────────────────────────────────
-- 7. Ordered tests stuck in non-terminal status
--    Terminal: COMPLETED, CANCELLED
--    Blocked tests are an explicit concern
-- ─────────────────────────────────────────────────────────────
SELECT
  ot.id,
  ot.catalog_item_name,
  ot.status,
  ot.block_reason,
  ot.order_id,
  o.requisition_number,
  o.tenant_id,
  ot.created_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - ot.created_at)) / 3600, 1) AS hours_since_created
FROM ordered_tests ot
JOIN orders o ON ot.order_id = o.id
WHERE ot.status NOT IN ('COMPLETED', 'CANCELLED')
  AND ot.created_at < NOW() - INTERVAL '48 hours'
ORDER BY ot.created_at;

-- ─────────────────────────────────────────────────────────────
-- 8. Turnaround time: specimen received → result released
--    Uses timeline_events for receive timestamp + result_report_releases for release timestamp
--    Joins through: release.order_id → order, timeline_event.order_id → order
-- ─────────────────────────────────────────────────────────────
SELECT
  rr.lab_tenant_id,
  t.name AS lab_name,
  COUNT(*) AS releases,
  ROUND(AVG(EXTRACT(EPOCH FROM (rr.released_at - te_recv.first_received)) / 3600), 1) AS avg_hours,
  ROUND(
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (rr.released_at - te_recv.first_received))
    ) / 3600, 1
  ) AS median_hours
FROM result_report_releases rr
JOIN tenants t ON rr.lab_tenant_id = t.id
JOIN LATERAL (
  SELECT MIN(te.created_at) AS first_received
  FROM timeline_events te
  WHERE te.order_id = rr.order_id
    AND te.event_type = 'RECEIVED_AT_LAB'
) te_recv ON te_recv.first_received IS NOT NULL
WHERE rr.released_at >= NOW() - INTERVAL '30 days'
  AND rr.release_type IN ('PARTIAL', 'FINAL')  -- exclude amendments from TAT
GROUP BY rr.lab_tenant_id, t.name;

-- ─────────────────────────────────────────────────────────────
-- 9. Workflow transitions per event type (last 7 days)
--    Useful for understanding system activity patterns
-- ─────────────────────────────────────────────────────────────
SELECT
  DATE(te.created_at) AS day,
  te.event_type,
  COUNT(*) AS event_count
FROM timeline_events te
WHERE te.created_at >= NOW() - INTERVAL '7 days'
GROUP BY day, te.event_type
ORDER BY day, event_count DESC;

-- ─────────────────────────────────────────────────────────────
-- 10. Result reports stuck in non-terminal status
--     Terminal: RELEASED
--     Concern: DRAFT or IN_REVIEW for too long
-- ─────────────────────────────────────────────────────────────
SELECT
  rp.id,
  rp.status,
  rp.tenant_id,
  rp.order_id,
  o.requisition_number,
  rp.created_at,
  rp.submitted_for_review_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - rp.created_at)) / 3600, 1) AS hours_since_created
FROM result_reports rp
JOIN orders o ON rp.order_id = o.id
WHERE rp.status IN ('DRAFT', 'IN_REVIEW')
  AND rp.created_at < NOW() - INTERVAL '48 hours'
ORDER BY rp.created_at;
```

---

#### Phase 7: Monitoring Runbook & Documentation (~45min)

| File | Action |
|------|--------|
| `docs/monitoring-runbook.md` | **Create** |

**Contents:**

1. **Finding errors in Sentry**
   - Navigate by project: `kesherio-api`, `kesherio-clinic`, `kesherio-lab`
   - Filter by environment: `production`
   - Search by request ID: tag `requestId`
   - Search by tenant: tag `tenantId`

2. **Searching Railway logs by request ID**
   - Railway dashboard → Service → Logs
   - Search: `"requestId":"<uuid>"` (JSON structured logs)
   - Filter by time range
   - Note: Railway log retention is limited — errors must be in Sentry or database audit records for the 2-week trip

3. **Identifying 5xx responses and slow requests**
   - Sentry: Issues → filter by `level:error`
   - Railway logs: search for `"level":"error"` or `"statusCode":5`
   - Sentry Performance: filter by p95 > threshold

4. **Determining affected tenant**
   - Every Sentry event includes `tenantId` tag
   - Every structured log includes `tenantId` field
   - Cross-reference with `tenants` table: `SELECT id, name FROM tenants`

5. **Checking health**
   - Liveness: `curl https://vet-ai-production.up.railway.app/api/health/live`
   - Readiness: `curl https://vet-ai-production.up.railway.app/api/health/ready`
   - 503 = database unreachable; check Railway service + Supabase status

6. **Disabling Sentry safely**
   - Remove/empty the `SENTRY_DSN` env var in Railway/Vercel
   - Redeploy — Sentry init becomes a no-op
   - No code change needed

7. **Environment variables reference** (complete list per platform)

8. **Sentry alert rules** (configure manually in Sentry UI):
   - **First seen**: alert on first occurrence of any new issue in `production`
   - **Regression**: alert when a resolved issue reappears
   - **High volume**: >10 events in 5 minutes for the same issue
   - Delivery: email (required) + Slack/push if configured

9. **External uptime monitoring** (manual setup):
   - API readiness: `GET /api/health/ready` — 5 min interval
   - API liveness: `GET /api/health/live` — 5 min interval
   - Clinic login page: `GET https://<clinic-url>/` — 5 min interval
   - Lab login page: `GET https://<lab-url>/` — 5 min interval
   - Recommended services: UptimeRobot (free), Better Stack, or Checkly
   - Configure email/SMS on downtime + recovery

10. **Railway health check configuration**:
    - Dashboard → Service → Settings → Health Check
    - Path: `/api/health/ready`
    - Timeout: 10s
    - Interval: 30s
    - This enables Railway's auto-restart on readiness failures

11. **Test error generation** (post-deploy verification):
    - API: `POST /api/health/test-error` (behind `InternalApiKeyGuard` — requires `x-internal-api-key` header)
    - Clinic: browser console → `throw new Error('Sentry test — clinic')`
    - Lab: browser console → `throw new Error('Sentry test — lab')`
    - Verify: error appears in correct Sentry project within 30s; alert email/notification arrives

---

### Day 3 (Wed 2026-09-10): Deployment verification & hardening

- [ ] Final lint + test + production build for all three apps
- [ ] Deploy API to Railway (verify `SENTRY_DSN` is set, source maps uploaded)
- [ ] Deploy clinic to Vercel (verify `NG_APP_SENTRY_DSN` is set)
- [ ] Deploy lab to Vercel (verify `VITE_SENTRY_DSN` is set)
- [ ] Trigger test error in each app → confirm Sentry captures it
- [ ] Confirm Sentry alert rule fires → email/phone notification received
- [ ] Verify health endpoints: `/api/health/live` and `/api/health/ready`
- [ ] Configure Railway health check
- [ ] Set up external uptime monitor (at least API readiness)
- [ ] Run SQL reporting queries against production database
- [ ] Security check: `grep -r "SENTRY_DSN\|sentry.io" --include="*.ts" --include="*.tsx"` — no hardcoded DSNs
- [ ] Verify `.gitignore` excludes `.env` files
- [ ] Verify 401/403/404 do not create Sentry events
- [ ] Verify health endpoints return no sensitive data
- [ ] Remove or gate the test-error endpoint if not needed post-verification

---

## Complete File Change List

### New files (12)
```
apps/api/src/instrument.ts                                    # Sentry init (API)
apps/api/src/common/filters/sentry-exception.filter.ts        # Global exception filter
apps/api/src/common/middleware/request-id.middleware.ts        # Request ID middleware
apps/api/src/common/interceptors/logging.interceptor.ts       # Structured JSON logging
apps/api/src/health/health.module.ts                          # Health module
apps/api/src/health/health.controller.ts                      # Liveness + readiness + test-error
apps/api/src/health/prisma-health.indicator.ts                # DB health check
apps/lab/src/sentry.ts                                        # Sentry init (lab)
apps/lab/src/app/shared/components/ErrorFallback.tsx           # Error boundary fallback UI
docs/monitoring-runbook.md                                     # Ops runbook
```

### Modified files (12)
```
package.json                                                   # new deps
Dockerfile                                                     # sentry-cli source-map upload
apps/api/src/main.ts                                           # import instrument + request-id middleware
apps/api/src/app/app.module.ts                                 # SentryModule, HealthModule, LoggingInterceptor
apps/frontend/src/main.ts                                      # Sentry.init()
apps/frontend/src/app/app.config.ts                            # Sentry ErrorHandler + TraceService
apps/frontend/src/environments/environment.ts                  # sentryDsn field
apps/frontend/src/environments/environment.production.ts       # sentryDsn with NG_APP_SENTRY_DSN
apps/lab/src/main.tsx                                          # import sentry
apps/lab/src/app/app.tsx                                       # ErrorBoundary wrapper
apps/lab/vite.config.ts                                        # sentryVitePlugin
.env.example                                                   # Sentry env vars
apps/lab/.env.example                                          # VITE_SENTRY_DSN
```

### New test files (4)
```
apps/api/src/common/middleware/request-id.middleware.spec.ts
apps/api/src/common/interceptors/logging.interceptor.spec.ts
apps/api/src/common/filters/sentry-exception.filter.spec.ts
apps/api/src/health/health.controller.spec.ts
```

### NOT changed (deferred)
```
apps/api/prisma/schema.prisma     # No AuditEvent model — use existing tables for pilot queries
apps/api/src/cases/cases.service.ts  # No case_created event emission
```

---

## Estimated Timeline

| Phase | Time | Day |
|-------|------|-----|
| 1. Sentry integration (3 apps) | ~2.5h | Mon |
| 2. Source-map uploads | ~1h | Mon |
| 3. Request IDs + structured logging | ~1.5h | Mon |
| 4. Health endpoints | ~30min | Mon |
| 5. Automated tests | ~1.5h | Tue |
| 6. Reporting queries (in runbook) | ~30min | Tue |
| 7. Runbook + documentation | ~45min | Tue |
| 8. Deployment verification + hardening | ~2h | Wed |
| **Total** | **~10h** | |
