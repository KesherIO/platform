/**
 * Route permission audit for every controller behind LabTenantGuard.
 *
 * - Every lab route declares its roles: a route without @Roles would be open
 *   to every lab member (messengers included), so it fails here.
 * - MESSENGER reaches exactly its pickup workflow, enforced by the real guard.
 * - Staff permissions are pinned until the permission matrix is approved
 *   (docs/LAB_PERMISSION_MATRIX.md); changing one is a deliberate edit here.
 */
import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { TenantRole } from '@vet-ai/shared-types';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { LabTenantGuard } from './lab-tenant.guard';
import { LabController } from './lab.controller';
import { LabNotificationsController } from './lab-notifications.controller';
import { LabConfigController } from '../lab-config/lab-config.controller';
import { CatalogController } from '../catalog/catalog.controller';
import { TemplateController } from '../results/template.controller';
import type { PrismaService } from '../prisma/prisma.service';

type Route = {
  key: string;
  handler: (...args: unknown[]) => unknown;
  controller: { name: string };
  roles: TenantRole[] | undefined;
};

const CONTROLLERS = [
  LabController,
  LabNotificationsController,
  LabConfigController,
  CatalogController,
  TemplateController,
];

function labRoutes(): Route[] {
  const routes: Route[] = [];
  for (const C of CONTROLLERS) {
    const base = Reflect.getMetadata(PATH_METADATA, C);
    const classGuards: { name: string }[] =
      Reflect.getMetadata(GUARDS_METADATA, C) ?? [];
    for (const name of Object.getOwnPropertyNames(C.prototype)) {
      const handler = C.prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      if (path === undefined) continue;
      const guards: { name: string }[] = [
        ...classGuards,
        ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
      ];
      if (!guards.some((g) => g.name === LabTenantGuard.name)) continue;
      const method =
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
      routes.push({
        key: `${method} ${`${base}/${path}`.replace(/\/+/g, '/')}`,
        handler,
        controller: C,
        roles:
          Reflect.getMetadata(ROLES_KEY, handler) ??
          Reflect.getMetadata(ROLES_KEY, C),
      });
    }
  }
  return routes;
}

/** Role sets since the lab roles consolidation of 2026-10-15 (lab-roles.ts). */
const STAFF = ['ADMIN', 'ANALYST', 'OWNER', 'REVIEWER'];
const STAFF_RECEPTION = [...STAFF, 'RECEPTIONIST'].sort();
const ADMIN = ['ADMIN', 'OWNER'];
const RELEASE = ['ADMIN', 'OWNER', 'REVIEWER'];
const RESULTS = [...STAFF, 'RESULTS_VIEWER'].sort();

/** Every lab member's own notification inbox. */
const INBOX_ROUTES = [
  'GET lab/notifications/',
  'GET lab/notifications/unread-count',
  'POST lab/notifications/read-all',
  'POST lab/notifications/:id/read',
];

/** The messenger's pickup workflow (MyPickupsPage, push, session) + inbox. */
const MESSENGER_ROUTES = [
  ...INBOX_ROUTES,
  'GET lab/me',
  'GET lab/my-pickups',
  'POST lab/pickups/:id/accept',
  'POST lab/pickups/:id/collected',
  'POST lab/pickups/:id/problem',
  'POST lab/messengers/me/push-subscription',
  'DELETE lab/messengers/me/push-subscription',
];

/** Release and its review actions: Revisor, Admin, Owner — not the Analista. */
const RELEASE_ROUTES = [
  'POST lab/orders/:orderId/approve-release',
  'POST lab/orders/:orderId/request-corrections',
  'POST lab/orders/:orderId/amendments/:amendmentId/approve',
  // "Por revisar" badge: only those who can release see what's waiting
  'GET lab/orders/review-count',
];

/** What "Consulta" (RESULTS_VIEWER) reaches: its session, inbox and released results. */
const RESULTS_VIEWER_ROUTES = [
  ...INBOX_ROUTES,
  'GET lab/me',
  'GET lab/results/search',
  'GET lab/results/clinics',
  'GET lab/results/analytes',
  'GET lab/orders/:orderId/releases',
  'GET lab/orders/:orderId/current-results',
  'GET lab/releases/:releaseId/artifacts/pdf',
  'GET lab/releases/:releaseId/artifacts/pdf/download',
  'POST lab/releases/:releaseId/artifacts/pdf/retry',
];

const routes = labRoutes();
const sorted = (r?: string[]) => [...(r ?? [])].sort();
const allowing = (role: string) =>
  routes
    .filter((r) => r.roles?.includes(role as TenantRole))
    .map((r) => r.key)
    .sort();

describe('lab route permissions', () => {
  it('finds the lab routes', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('every lab route declares @Roles', () => {
    const open = routes.filter((r) => !r.roles?.length).map((r) => r.key);
    expect(open).toEqual([]);
  });

  it('the legacy unreviewed release route is gone', () => {
    expect(routes.map((r) => r.key)).not.toContain(
      'POST lab/reports/:reportId/release'
    );
  });

  it('MESSENGER is allowed on exactly its pickup workflow', () => {
    expect(allowing('MESSENGER')).toEqual([...MESSENGER_ROUTES].sort());
  });

  it('RESULTS_VIEWER is allowed on exactly its session and released results', () => {
    expect(allowing('RESULTS_VIEWER')).toEqual(
      [...RESULTS_VIEWER_ROUTES].sort()
    );
  });

  it('no lab route admits the retired lab roles TECHNICIAN or DATA_ENTRY', () => {
    expect([...allowing('TECHNICIAN'), ...allowing('DATA_ENTRY')]).toEqual([]);
  });

  it('messenger routes keep every staff role', () => {
    for (const r of routes.filter((x) => MESSENGER_ROUTES.includes(x.key))) {
      expect(sorted(r.roles)).toEqual(expect.arrayContaining(STAFF));
    }
  });

  it('every other route is staff, staff+reception, admin, release or results', () => {
    const allowedSets = [STAFF, STAFF_RECEPTION, ADMIN, RELEASE, RESULTS].map(
      (s) => JSON.stringify([...s].sort())
    );
    const unexpected = routes
      .filter((r) => !MESSENGER_ROUTES.includes(r.key))
      .filter((r) => !allowedSets.includes(JSON.stringify(sorted(r.roles))))
      .map((r) => `${r.key}: ${sorted(r.roles).join(',')}`);
    expect(unexpected).toEqual([]);
  });

  it('only the release routes use the release set', () => {
    const release = routes
      .filter(
        (r) => JSON.stringify(sorted(r.roles)) === JSON.stringify(RELEASE)
      )
      .map((r) => r.key)
      .sort();
    expect(release).toEqual([...RELEASE_ROUTES].sort());
  });

  it('changing a role stays ADMIN/OWNER only', () => {
    const route = routes.find((r) => r.key === 'PATCH lab/users/:userId/role');
    expect(sorted(route?.roles)).toEqual(ADMIN);
  });

  describe('enforced by LabTenantGuard', () => {
    const guardFor = (role: string) =>
      new LabTenantGuard(
        {
          userTenantMembership: {
            findUnique: jest.fn().mockResolvedValue({
              role,
              status: 'ACTIVE',
              canPerformPickups: false,
              canViewInProgress: false,
              tenant: { id: 'lab-1', name: 'Lab', logoUrl: null, type: 'LAB' },
            }),
          },
        } as unknown as PrismaService,
        new Reflector()
      );

    const contextFor = (route: Route) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 'user-1' },
            headers: { 'x-tenant-id': 'lab-1' },
          }),
        }),
        getHandler: () => route.handler,
        getClass: () => route.controller,
      } as unknown as ExecutionContext);

    const cases = (keys: string[], inside: boolean) =>
      routes
        .filter((r) => keys.includes(r.key) === inside)
        .map((r) => [r.key, r] as const);

    it.each(cases(MESSENGER_ROUTES, false))(
      'MESSENGER → 403 on %s',
      async (_key, route) => {
        await expect(
          guardFor('MESSENGER').canActivate(contextFor(route))
        ).rejects.toThrow(ForbiddenException);
      }
    );

    it.each(cases(MESSENGER_ROUTES, true))(
      'MESSENGER → allowed on %s',
      async (_key, route) => {
        await expect(
          guardFor('MESSENGER').canActivate(contextFor(route))
        ).resolves.toBe(true);
      }
    );

    it.each(cases(RESULTS_VIEWER_ROUTES, false))(
      'RESULTS_VIEWER → 403 on %s',
      async (_key, route) => {
        await expect(
          guardFor('RESULTS_VIEWER').canActivate(contextFor(route))
        ).rejects.toThrow(ForbiddenException);
      }
    );

    it.each(cases(RELEASE_ROUTES, true))(
      'ANALYST → 403 on %s',
      async (_key, route) => {
        await expect(
          guardFor('ANALYST').canActivate(contextFor(route))
        ).rejects.toThrow(ForbiddenException);
      }
    );

    it.each(cases(RELEASE_ROUTES, true))(
      'REVIEWER → allowed on %s',
      async (_key, route) => {
        await expect(
          guardFor('REVIEWER').canActivate(contextFor(route))
        ).resolves.toBe(true);
      }
    );
  });
});
