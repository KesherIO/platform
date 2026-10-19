/**
 * Billing endpoints over real HTTP: the real controllers, the real
 * LabTenantGuard (membership + role read from the database on every request),
 * the app's global ValidationPipe and a real Postgres. Only the JWT parsing is
 * replaced (a test header names the caller), because the Supabase JWKS is not
 * available here — everything after "who is calling" is production code.
 *
 * Covers every billing route and the catalog PATCH used for inline mapping:
 * who may call them, that a caller can only ever act on the lab named by a
 * membership of theirs, and that nothing in a request body/query/path can
 * redirect an operation to another lab.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set (throwaway database only).
 */
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'net';
import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import { CatalogController } from '../catalog/catalog.controller';
import { CatalogService } from '../catalog/catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingController } from './billing.controller';
import { BillingExportService } from './billing-export.service';
import { BillingMappingService } from './billing-mapping.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Billing endpoints over HTTP (permissions and isolation)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  const runId = randomUUID().slice(0, 8);

  let labA: string;
  let labB: string;
  let clinic: string;
  let itemA: string; // lab A TEST with billing code
  let itemB: string; // lab B TEST with billing code
  let exportA: string; // a generated export of lab A
  const goneId = `gone-${runId}`; // deleted item referenced by a lab A order
  const DAY = '2026-10-18';
  const userByName: Record<string, string> = {};
  const createdUsers: string[] = [];

  const ROLES_DENIED = [
    'ANALYST',
    'REVIEWER',
    'RESULTS_VIEWER',
    'MESSENGER',
    'RECEPTIONIST',
    'VET',
    'TECHNICIAN',
    'DATA_ENTRY',
  ] as const;
  const ROLES_ALLOWED = ['ADMIN', 'OWNER'] as const;

  async function call(
    method: string,
    path: string,
    opts: { as?: string; tenant?: string; body?: unknown } = {}
  ) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (opts.as) headers['x-test-user'] = userByName[opts.as] ?? opts.as;
    if (opts.tenant) headers['x-tenant-id'] = opts.tenant;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json: json as any, text };
  }

  /** Every billing route plus the catalog PATCH used for inline mapping. */
  const routes = () => [
    {
      name: 'mapping/suggest',
      method: 'POST',
      path: '/lab/billing/mapping/suggest',
      body: { rows: [{ code: 'X', description: 'Albumina' }] },
    },
    {
      name: 'mapping/apply',
      method: 'POST',
      path: '/lab/billing/mapping/apply',
      body: { assignments: [{ catalogItemId: itemA, billingCode: 'ALT-A' }] },
    },
    {
      name: 'deleted-items PUT',
      method: 'PUT',
      path: `/lab/billing/deleted-items/${goneId}/code`,
      body: { billingCode: 'GONE-CODE' },
    },
    {
      name: 'deleted-items DELETE',
      method: 'DELETE',
      path: `/lab/billing/deleted-items/${goneId}/code`,
    },
    {
      name: 'exports/preview',
      method: 'GET',
      path: `/lab/billing/exports/preview?dateFrom=${DAY}&dateTo=${DAY}`,
    },
    {
      name: 'exports POST (generate)',
      method: 'POST',
      path: '/lab/billing/exports',
      body: { dateFrom: DAY, dateTo: DAY },
    },
    { name: 'exports GET (history)', method: 'GET', path: '/lab/billing/exports' },
    {
      name: 'exports/:id (download)',
      method: 'GET',
      path: `/lab/billing/exports/${exportA}`,
    },
    {
      name: 'catalog PATCH (inline mapping)',
      method: 'PATCH',
      path: `/catalog/${itemA}`,
      body: { billingCode: 'ALT-A' },
    },
  ];

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();

    const mk = (name: string, type: 'LAB' | 'CLINIC') =>
      prisma.tenant.create({
        data: {
          name: `${name} ${runId}`,
          slug: `it-http-${name}-${runId}`,
          type,
          timezone: 'America/Bogota',
        },
      });
    labA = (await mk('labA', 'LAB')).id;
    labB = (await mk('labB', 'LAB')).id;
    clinic = (await mk('clinic', 'CLINIC')).id;

    const mkUser = async (
      name: string,
      memberships: Array<{
        tenantId: string;
        role: string;
        status?: string;
        canViewInProgress?: boolean;
      }>
    ) => {
      const id = randomUUID();
      await prisma.user.create({
        data: { id, email: `it-http-${name}-${runId}@it.example.com` },
      });
      for (const m of memberships) {
        await prisma.userTenantMembership.create({
          data: {
            userId: id,
            tenantId: m.tenantId,
            role: m.role as never,
            status: (m.status ?? 'ACTIVE') as never,
            canViewInProgress: m.canViewInProgress ?? false,
          },
        });
      }
      userByName[name] = id;
      createdUsers.push(id);
    };
    for (const role of [...ROLES_ALLOWED, ...ROLES_DENIED]) {
      await mkUser(role, [{ tenantId: labA, role }]);
    }
    // "Consulta" with the "Puede ver órdenes en proceso" checkbox (the Facturación user)
    await mkUser('consultaWithFlag', [
      { tenantId: labA, role: 'RESULTS_VIEWER', canViewInProgress: true },
    ]);
    await mkUser('adminB', [{ tenantId: labB, role: 'ADMIN' }]);
    // ADMIN in lab A, only ANALYST in lab B
    await mkUser('multi', [
      { tenantId: labA, role: 'ADMIN' },
      { tenantId: labB, role: 'ANALYST' },
    ]);
    await mkUser('suspendedAdmin', [
      { tenantId: labA, role: 'ADMIN', status: 'SUSPENDED' },
    ]);
    await mkUser('stranger', []);

    const item = async (lab: string, name: string, billingCode: string) =>
      (
        await prisma.catalogItem.create({
          data: { labTenantId: lab, kind: 'TEST', code: name, name, billingCode },
        })
      ).id;
    itemA = await item(labA, 'ALT', 'ALT-A');
    itemB = await item(labB, 'ALT', 'ALT-B');

    const createdBy = userByName['ADMIN'];
    const order = async (lab: string, patient: string, itemId: string, code: string) => {
      const kase = await prisma.case.create({
        data: {
          tenantId: clinic,
          patientName: patient,
          patientSpecies: 'DOG',
          ownerName: `Owner ${patient}`,
          createdByUserId: createdBy,
        },
      });
      return prisma.order.create({
        data: {
          requisitionNumber: `IT-${randomUUID().slice(0, 8)}`,
          caseId: kase.id,
          tenantId: clinic,
          labTenantId: lab,
          createdAt: new Date(`${DAY}T15:00:00Z`),
          orderedItems: [
            {
              catalogItemId: itemId,
              code,
              name: code,
              kind: 'TEST',
              category: null,
              turnaroundHours: null,
            },
          ],
        },
      });
    };
    await order(labA, 'Patient A', itemA, 'ALT');
    await order(labB, 'Patient B', itemB, 'ALT');
    // a lab A order whose catalog item no longer exists
    await order(labA, 'Orphan A', goneId, 'OLD');

    // Gone-item code so the first export can succeed
    const exportService = new BillingExportService(prisma);
    const mappingService = new BillingMappingService(prisma);
    await mappingService.assignDeletedItemCode(labA, goneId, 'GONE-0', {
      id: createdBy,
      name: 'Seed',
    });
    exportA = (
      await exportService.generate(
        labA,
        { id: createdBy, name: 'Seed' },
        { dateFrom: DAY, dateTo: DAY }
      )
    ).exportId;
    await mappingService.clearDeletedItemCode(labA, goneId);

    const allow = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [BillingController, CatalogController],
      providers: [
        BillingExportService,
        BillingMappingService,
        CatalogService,
        LabTenantGuard, // the real one
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest();
          const id = req.headers['x-test-user'];
          if (!id) throw new UnauthorizedException();
          req.user = { id, email: `${id}@it.example.com` };
          return true;
        },
      })
      .overrideGuard(TenantGuard)
      .useValue(allow)
      .overrideGuard(InternalApiKeyGuard)
      .useValue(allow)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app?.close();
    for (const id of [clinic, labA, labB]) {
      await prisma.tenant.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of createdUsers) {
      await prisma.user.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  /** Routes the Facturación user (Consulta + checkbox) may use: downloads only */
  const READ_ROUTES = [
    'exports/preview',
    'exports POST (generate)',
    'exports GET (history)',
    'exports/:id (download)',
  ];

  describe('who may call', () => {
    it('anonymous callers get 401 on every route', async () => {
      for (const r of routes()) {
        const res = await call(r.method, r.path, { body: r.body });
        expect([r.name, res.status]).toEqual([r.name, 401]);
      }
    });

    it.each(ROLES_DENIED)('%s of the lab gets 403 on every route', async (role) => {
      for (const r of routes()) {
        const res = await call(r.method, r.path, {
          as: role,
          tenant: labA,
          body: r.body,
        });
        expect([r.name, res.status]).toEqual([r.name, 403]);
      }
    });

    it('denied roles cause no side effects', async () => {
      const exportsBefore = await prisma.billingExport.count({
        where: { labTenantId: labA },
      });
      const itemBefore = await prisma.catalogItem.findUniqueOrThrow({
        where: { id: itemA },
      });
      const codesBefore = await prisma.billingDeletedItemCode.count();
      for (const role of ROLES_DENIED) {
        for (const r of routes()) {
          if (r.method === 'GET') continue;
          await call(r.method, r.path, {
            as: role,
            tenant: labA,
            body:
              r.name === 'mapping/apply'
                ? { assignments: [{ catalogItemId: itemA, billingCode: 'HACK' }] }
                : r.name === 'catalog PATCH (inline mapping)'
                ? { billingCode: 'HACK' }
                : r.body,
          });
        }
      }
      expect(
        await prisma.billingExport.count({ where: { labTenantId: labA } })
      ).toBe(exportsBefore);
      expect(
        (await prisma.catalogItem.findUniqueOrThrow({ where: { id: itemA } }))
          .billingCode
      ).toBe(itemBefore.billingCode);
      expect(await prisma.billingDeletedItemCode.count()).toBe(codesBefore);
    });

    it.each(ROLES_ALLOWED)('%s is let through on every route', async (role) => {
      for (const r of routes()) {
        const res = await call(r.method, r.path, {
          as: role,
          tenant: labA,
          body: r.body,
        });
        // The guard let them in (a domain answer, never 401/403)
        expect([r.name, [401, 403].includes(res.status)]).toEqual([r.name, false]);
      }
    });

    it('Consulta WITH the in-progress checkbox may download, and only download', async () => {
      for (const r of routes()) {
        const res = await call(r.method, r.path, {
          as: 'consultaWithFlag',
          tenant: labA,
          body: r.body,
        });
        const allowed = READ_ROUTES.includes(r.name);
        expect([r.name, allowed ? res.status < 400 || res.status === 409 : res.status === 403]).toEqual([
          r.name,
          true,
        ]);
      }
    });

    it('Consulta WITHOUT the checkbox gets 403 on the downloads too (it includes pending orders)', async () => {
      for (const r of routes().filter((x) => READ_ROUTES.includes(x.name))) {
        const res = await call(r.method, r.path, {
          as: 'RESULTS_VIEWER',
          tenant: labA,
          body: r.body,
        });
        expect([r.name, res.status]).toEqual([r.name, 403]);
      }
    });

    it('Consulta cannot set codes: no catalog or mapping change, no deleted-item code', async () => {
      const before = await prisma.billingDeletedItemCode.count();
      for (const r of routes().filter((x) => !READ_ROUTES.includes(x.name))) {
        await call(r.method, r.path, {
          as: 'consultaWithFlag',
          tenant: labA,
          body:
            r.name === 'catalog PATCH (inline mapping)'
              ? { billingCode: 'HACK' }
              : r.name === 'mapping/apply'
              ? { assignments: [{ catalogItemId: itemA, billingCode: 'HACK' }] }
              : r.body,
        });
      }
      expect(
        (await prisma.catalogItem.findUniqueOrThrow({ where: { id: itemA } }))
          .billingCode
      ).toBe('ALT-A');
      expect(await prisma.billingDeletedItemCode.count()).toBe(before);
    });

    it("Consulta's own lab only: with the checkbox in lab A, lab B stays closed", async () => {
      for (const r of routes().filter((x) => READ_ROUTES.includes(x.name))) {
        const res = await call(r.method, r.path, {
          as: 'consultaWithFlag',
          tenant: labB,
          body: r.body,
        });
        expect([r.name, res.status]).toEqual([r.name, 403]);
      }
    });

    it("Consulta's download covers pending orders and equals what an admin gets", async () => {
      const viewer = await call(
        'GET',
        `/lab/billing/exports/preview?dateFrom=${DAY}&dateTo=${DAY}`,
        { as: 'consultaWithFlag', tenant: labA }
      );
      const admin = await call(
        'GET',
        `/lab/billing/exports/preview?dateFrom=${DAY}&dateTo=${DAY}`,
        { as: 'ADMIN', tenant: labA }
      );
      expect(viewer.status).toBe(200);
      expect(viewer.json.lines).toEqual(admin.json.lines);
      // the seeded order has no OrderedTest yet: pending, and still listed
      expect(
        viewer.json.lines.map((l: { patientName: string }) => l.patientName)
      ).toContain('Patient A');
    });

    it('a suspended admin and a user with no membership get 403', async () => {
      for (const as of ['suspendedAdmin', 'stranger']) {
        for (const r of routes()) {
          const res = await call(r.method, r.path, {
            as,
            tenant: labA,
            body: r.body,
          });
          expect([as, r.name, res.status]).toEqual([as, r.name, 403]);
        }
      }
    });
  });

  describe('lab isolation', () => {
    it("an admin of lab B naming lab A in the tenant header is refused (not a member)", async () => {
      for (const r of routes()) {
        const res = await call(r.method, r.path, {
          as: 'adminB',
          tenant: labA,
          body: r.body,
        });
        expect([r.name, res.status]).toEqual([r.name, 403]);
      }
    });

    it('the role is the one held in the lab being addressed', async () => {
      // ADMIN in A …
      const a = await call('GET', '/lab/billing/exports', {
        as: 'multi',
        tenant: labA,
      });
      expect(a.status).toBe(200);
      // … but only ANALYST in B
      for (const r of routes()) {
        const res = await call(r.method, r.path, {
          as: 'multi',
          tenant: labB,
          body: r.body,
        });
        expect([r.name, res.status]).toEqual([r.name, 403]);
      }
    });

    it("lab B cannot read lab A's exports, history or orders", async () => {
      const own = { as: 'adminB', tenant: labB };
      expect((await call('GET', `/lab/billing/exports/${exportA}`, own)).status).toBe(404);

      const history = await call('GET', '/lab/billing/exports', own);
      expect(history.status).toBe(200);
      expect(history.json.data.map((e: { id: string }) => e.id)).not.toContain(exportA);

      const preview = await call(
        'GET',
        `/lab/billing/exports/preview?dateFrom=${DAY}&dateTo=${DAY}`,
        own
      );
      expect(preview.json.lines.map((l: { patientName: string }) => l.patientName)).toEqual([
        'Patient B',
      ]);
    });

    it("lab B cannot map, rename or code lab A's catalog items or deleted items", async () => {
      const own = { as: 'adminB', tenant: labB };
      const apply = await call('POST', '/lab/billing/mapping/apply', {
        ...own,
        body: { assignments: [{ catalogItemId: itemA, billingCode: 'HACK' }] },
      });
      expect(apply.status).toBe(400);

      const patch = await call('PATCH', `/catalog/${itemA}`, {
        ...own,
        body: { billingCode: 'HACK' },
      });
      expect(patch.status).toBe(404);

      const put = await call('PUT', `/lab/billing/deleted-items/${goneId}/code`, {
        ...own,
        body: { billingCode: 'HACK' },
      });
      expect(put.status).toBe(404); // no lab B order has that line

      const stored = await prisma.catalogItem.findUniqueOrThrow({ where: { id: itemA } });
      expect(stored.billingCode).toBe('ALT-A');
    });

    it("suggestions only rank the caller's own catalog", async () => {
      const res = await call('POST', '/lab/billing/mapping/suggest', {
        as: 'adminB',
        tenant: labB,
        body: { rows: [{ code: 'ALT', description: 'ALT' }] },
      });
      const ids = res.json.suggestions.flatMap((s: { candidates: Array<{ catalogItemId: string }> }) =>
        s.candidates.map((c) => c.catalogItemId)
      );
      expect(ids).toContain(itemB);
      expect(ids).not.toContain(itemA);
    });

    it('a lab id smuggled into the body or query cannot redirect a write or a read', async () => {
      const before = await prisma.billingExport.count({ where: { labTenantId: labA } });
      const gen = await call('POST', '/lab/billing/exports', {
        as: 'adminB',
        tenant: labB,
        body: { dateFrom: '2026-11-01', dateTo: '2026-11-01', labTenantId: labA, tenantId: labA },
      });
      // nothing in lab B's range, and nothing was recorded under lab A
      expect(gen.status).toBe(400);
      expect(gen.json.code).toBe('NOTHING_TO_EXPORT');
      expect(await prisma.billingExport.count({ where: { labTenantId: labA } })).toBe(before);

      const preview = await call(
        'GET',
        `/lab/billing/exports/preview?dateFrom=${DAY}&dateTo=${DAY}&labTenantId=${labA}`,
        { as: 'adminB', tenant: labB }
      );
      expect(preview.status).toBe(200);
      expect(preview.json.lines.map((l: { patientName: string }) => l.patientName)).toEqual([
        'Patient B',
      ]);
    });
  });

  describe('what an authorized admin gets', () => {
    const own = { as: 'ADMIN', tenant: labA };

    it('previews, generates, lists and re-downloads in their own lab', async () => {
      const preview = await call(
        'GET',
        `/lab/billing/exports/preview?dateFrom=${DAY}&dateTo=${DAY}`,
        own
      );
      expect(preview.status).toBe(200);
      expect(preview.json.timezone).toBe('America/Bogota');

      const gen = await call('POST', '/lab/billing/exports', {
        ...own,
        body: { dateFrom: DAY, dateTo: '2026-10-18' },
      });
      // the orphan line has no code now (cleared in setup) → blocked, listed
      expect(gen.status).toBe(409);
      expect(gen.json.code).toBe('MISSING_BILLING_CODES');
      expect(gen.json.missingCodes[0].catalogItemId).toBe(goneId);

      const put = await call('PUT', `/lab/billing/deleted-items/${goneId}/code`, {
        ...own,
        body: { billingCode: 'GONE-1' },
      });
      expect(put.status).toBe(200);

      const ok = await call('POST', '/lab/billing/exports', {
        ...own,
        body: { dateFrom: DAY, dateTo: DAY },
      });
      expect(ok.status).toBe(200);
      expect(ok.json.columns.map((c: { header: string }) => c.header)).toEqual([
        'fecha',
        'entidad',
        'item',
        'cantidad',
        'nombre del paciente',
      ]);

      const list = await call('GET', '/lab/billing/exports', own);
      expect(list.json.data.map((e: { id: string }) => e.id)).toContain(ok.json.exportId);
      const down = await call('GET', `/lab/billing/exports/${ok.json.exportId}`, own);
      expect(down.json.rows).toEqual(ok.json.rows);

      expect((await call('DELETE', `/lab/billing/deleted-items/${goneId}/code`, own)).status).toBe(200);
    });

    it('rejects malformed requests before they reach a service', async () => {
      expect(
        (await call('GET', '/lab/billing/exports/preview?dateFrom=18/10/2026&dateTo=2026-10-18', own)).status
      ).toBe(400);
      expect(
        (await call('POST', '/lab/billing/mapping/suggest', { ...own, body: { rows: [] } })).status
      ).toBe(400);
      expect(
        (await call('POST', '/lab/billing/mapping/apply', { ...own, body: { assignments: [] } })).status
      ).toBe(400);
    });
  });
});
