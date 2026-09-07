# KesherIO — Monitoring Runbook

**Last updated**: 2026-09-07  
**Audience**: On-call / pilot monitoring during two-week travel period

---

## 1. Architecture Overview

| App | Framework | Deploy target | Monitoring |
|-----|-----------|---------------|------------|
| Clinic frontend | Angular 21 | Vercel (static SPA) | Sentry `kesherio-clinic` |
| Lab portal | React 19 + Vite | Vercel (static SPA) | Sentry `kesherio-lab` |
| API | NestJS 11 | Railway (Docker) | Sentry `kesherio-api` + structured Railway logs |

Both frontends proxy `/api/*` to the Railway API via Vercel rewrites.

---

## 2. Finding Errors in Sentry

1. Go to [sentry.io](https://sentry.io) → select the correct project:
   - `kesherio-api` for backend errors
   - `kesherio-clinic` for clinic frontend errors
   - `kesherio-lab` for lab portal errors
2. Filter by **Environment: production**
3. Search by request ID: filter tag `requestId:<uuid>`
4. Search by tenant: filter tag `tenantId:<id>` (available when the request was authenticated and tenant context was resolved — public, unauthenticated, and early authentication failures will not have tenant information)
5. Each API error includes: `requestId`, `userId` (when authenticated), `tenantId` and `role` (when tenant context was resolved)

---

## 3. Searching Railway Logs by Request ID

1. Railway dashboard → select the API service → **Logs** tab
2. Search for: `"requestId":"<uuid>"`
3. Each log line is structured JSON:
   ```json
   {
     "level": "info|warn|error",
     "message": "HTTP GET /api/orders 200 45ms",
     "requestId": "...",
     "method": "GET",
     "route": "/api/orders",
     "statusCode": 200,
     "durationMs": 45,
     "userId": "...",
     "tenantId": "...",
     "role": "VET",
     "environment": "production",
     "timestamp": "2026-09-08T15:30:00.000Z"
   }
   ```
4. `level: "error"` → 5xx; `level: "warn"` → 4xx

**Important**: Railway log retention may be shorter than two weeks. All unhandled exceptions and 5xx errors are captured in Sentry, which has longer retention. For business-critical audit data, use the existing `timeline_events` and `result_report_releases` database tables.

---

## 4. Identifying 5xx Responses and Slow Requests

**In Railway logs:**
- 5xx errors: search `"level":"error"`
- Slow requests: search for high `durationMs` values

**In Sentry:**
- Issues → filter by `level:error`
- Performance → sort by p95 duration

---

## 5. Determining Affected Tenant

- Sentry events include `tenantId` tag when available (authenticated + tenant-resolved requests)
- Railway structured logs include `tenantId` field
- Cross-reference: `SELECT id, name, type FROM tenants WHERE id = '<tenantId>'`

---

## 6. Checking API and Database Health

```bash
# Liveness — is the process running?
curl https://vet-ai-production.up.railway.app/api/health/live
# Expected: {"status":"ok"}

# Readiness — is the database reachable?
curl https://vet-ai-production.up.railway.app/api/health/ready
# Expected: {"status":"ok","details":{"database":{"status":"up"}}}
# Failure:  503 with {"status":"error","details":{"database":{"status":"down"}}}
```

If readiness fails:
1. Check Supabase status page
2. Check Railway service logs for connection errors
3. Verify `DATABASE_URL` env var is correct in Railway

---

## 7. Disabling Sentry Safely

If Sentry causes a performance issue or unexpected behavior:

1. **API**: In Railway → Service → Variables → remove or empty `SENTRY_DSN` → redeploy
2. **Clinic**: In Vercel → Project → Settings → Environment Variables → remove `NG_APP_SENTRY_DSN` → redeploy
3. **Lab**: In Vercel → Project → Settings → Environment Variables → remove `VITE_SENTRY_DSN` → redeploy

No code change needed — `Sentry.init()` is conditional on the DSN being present.

---

## 8. Environment Variables Reference

### Railway (API service)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection |
| `SUPABASE_URL` | Yes | — | JWT validation |
| `SUPABASE_ANON_KEY` | Yes | — | Supabase client |
| `SUPABASE_JWT_SECRET` | Yes | — | JWT verification |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Server-side Supabase |
| `PORT` | No | `3000` | API port |
| `NODE_ENV` | No | `production` | Environment |
| `INTERNAL_API_KEY` | Yes | — | Internal endpoint auth |
| `ANTHROPIC_API_KEY` | Yes | — | AI triage |
| `SENTRY_DSN` | No | — | Sentry (disabled if empty) |
| `SENTRY_ENVIRONMENT` | No | `production` | Sentry environment tag |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0.1` | Performance trace rate |
| `FRONTEND_URL` | No | `http://localhost:4200` | CORS |
| `LAB_URL` | No | `http://localhost:4201` | CORS |

**Build-only variables** (Docker build args, not in runtime):

| Variable | Purpose |
|----------|---------|
| `SENTRY_AUTH_TOKEN` | Source-map upload auth |
| `SENTRY_ORG` | Sentry org slug |
| `SENTRY_PROJECT` | `kesherio-api` |
| `RAILWAY_GIT_COMMIT_SHA` | Release identifier (auto-set by Railway) |

### Vercel — Clinic (`frontend`)

| Variable | Purpose |
|----------|---------|
| `NG_APP_SENTRY_DSN` | Sentry DSN (build-time, injected via pre-build script) |
| `SENTRY_AUTH_TOKEN` | Source-map upload (build-time only, not in bundle) |
| `SENTRY_ORG` | Sentry org slug |
| `SENTRY_PROJECT` | `kesherio-clinic` |

### Vercel — Lab

| Variable | Purpose |
|----------|---------|
| `VITE_SENTRY_DSN` | Sentry DSN (exposed to client via Vite `VITE_` prefix) |
| `VITE_SENTRY_ENVIRONMENT` | Sentry environment tag |
| `SENTRY_AUTH_TOKEN` | Source-map upload (build-time only) |
| `SENTRY_ORG` | Sentry org slug |
| `SENTRY_PROJECT` | `kesherio-lab` |

---

## 9. Sentry Alert Rules (Configure Manually)

Create these in Sentry UI → Alerts → Create Alert Rule:

### 9a. First Seen Issue
- **When**: A new issue is created (first occurrence)
- **Filter**: `environment:production`
- **Action**: Send email notification
- **Projects**: All three

### 9b. Regression
- **When**: A resolved issue reappears
- **Filter**: `environment:production`
- **Action**: Send email notification

### 9c. High Volume
- **When**: An issue occurs more than 10 times in 5 minutes
- **Filter**: `environment:production`
- **Action**: Send email notification (critical)

---

## 10. External Uptime Monitoring (Manual Setup)

Use a free monitoring service (UptimeRobot, Better Stack, or Checkly):

| Monitor | URL | Interval | Alert |
|---------|-----|----------|-------|
| API readiness | `GET https://vet-ai-production.up.railway.app/api/health/ready` | 5 min | Email + SMS on downtime and recovery |
| Clinic login | `GET https://<clinic-vercel-url>/` | 5 min | Email on downtime and recovery |
| Lab login | `GET https://<lab-vercel-url>/` | 5 min | Email on downtime and recovery |

The `/api/health/live` endpoint is available for diagnostic use but does not need a separate external monitor — `/api/health/ready` provides strictly more information (it confirms both process liveness and database connectivity).

---

## 11. Railway Health Check Configuration

In Railway dashboard → Service → Settings → Deploy section:

- **Health Check Path**: `/api/health/ready`
- **Timeout**: 10 seconds

This allows Railway to detect readiness failures during deployments. Note that Railway's health check operates primarily during deployment rollouts — it does not provide continuous uptime monitoring or guaranteed automatic recovery for all runtime failure scenarios. External uptime monitoring (section 10) remains necessary for continuous availability alerting during the travel period.

---

## 12. Alert Verification (Test Error Generation)

### API
```bash
curl -X POST https://vet-ai-production.up.railway.app/api/health/test-error \
  -H "x-internal-api-key: <your-key>"
# Expected: {"captured":true,"message":"Sentry test error — API"}
```

### Clinic Frontend
Open the clinic app in a browser, open the developer console, and run:
```js
import("https://cdn.jsdelivr.net/npm/@sentry/angular/+esm")
  .catch(() => window.__SENTRY__)
// OR if Sentry is already loaded globally, use the window.__SENTRY__ handle:
// This approach requires a temporary test mechanism:
```
**Preferred**: A temporary admin-only button or console function is provided during pilot setup that calls `Sentry.captureException(new Error('Sentry test — clinic'))` explicitly. Verify the event appears in the `kesherio-clinic` Sentry project.

### Lab Portal
Open the lab app in a browser, open the developer console, and run:
```js
window.__SENTRY_TEST__ && window.__SENTRY_TEST__();
```
A temporary global function is registered in `sentry.ts` during pilot mode. It calls `Sentry.captureException()` directly. Verify the event appears in the `kesherio-lab` Sentry project.

**After verification**: Remove the test-error endpoint (`POST /api/health/test-error`) and any temporary frontend test mechanisms before final handoff.

---

## 13. Operational Reporting Queries

Run these against the production PostgreSQL database (via Supabase SQL editor or `psql`).

All table names, column names, and enum values are verified against the Prisma schema.

### 13a. Daily Active Users
```sql
SELECT
  DATE(te.created_at) AS day,
  COUNT(DISTINCT te.actor_id) AS active_users
FROM timeline_events te
WHERE te.actor_id IS NOT NULL
  AND te.created_at >= NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day;
```

### 13b. Cases Created per Tenant per Day
```sql
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
```

### 13c. Orders Created per Tenant per Day
```sql
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
```

### 13d. Results Released per Day
```sql
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
```

### 13e. Orders Stuck in Non-Terminal Status (>48h)
```sql
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
```

### 13f. Specimens Stuck in Non-Terminal Status (>24h)
```sql
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
```

### 13g. Ordered Tests Stuck in Non-Terminal Status (>48h)
```sql
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
```

### 13h. Turnaround Time: Specimen Received → Result Released
```sql
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
  AND rr.release_type IN ('PARTIAL', 'FINAL')
GROUP BY rr.lab_tenant_id, t.name;
```

### 13i. Workflow Transitions per Event Type (Last 7 Days)
```sql
SELECT
  DATE(te.created_at) AS day,
  te.event_type,
  COUNT(*) AS event_count
FROM timeline_events te
WHERE te.created_at >= NOW() - INTERVAL '7 days'
GROUP BY day, te.event_type
ORDER BY day, event_count DESC;
```

### 13j. Result Reports Stuck in Non-Terminal Status (>48h)
```sql
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
