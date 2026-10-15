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

const STAFF = [
  'ADMIN',
  'ANALYST',
  'DATA_ENTRY',
  'OWNER',
  'REVIEWER',
  'TECHNICIAN',
];
const STAFF_RECEPTION = [...STAFF, 'RECEPTIONIST'].sort();
const ADMIN = ['ADMIN', 'OWNER'];

/** The messenger's pickup workflow (MyPickupsPage, push, session). */
const MESSENGER_ROUTES = [
  'GET lab/me',
  'GET lab/my-pickups',
  'POST lab/pickups/:id/accept',
  'POST lab/pickups/:id/collected',
  'POST lab/pickups/:id/problem',
  'POST lab/messengers/me/push-subscription',
  'DELETE lab/messengers/me/push-subscription',
];

const routes = labRoutes();
const sorted = (r?: string[]) => [...(r ?? [])].sort();

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
    const allowed = routes
      .filter((r) => r.roles?.includes(TenantRole.MESSENGER))
      .map((r) => r.key)
      .sort();
    expect(allowed).toEqual([...MESSENGER_ROUTES].sort());
  });

  it('messenger routes keep every staff role', () => {
    for (const r of routes.filter((x) => MESSENGER_ROUTES.includes(x.key))) {
      expect(sorted(r.roles)).toEqual([...STAFF, 'MESSENGER'].sort());
    }
  });

  it('staff permissions are unchanged: every route is staff, staff+reception or admin', () => {
    const unexpected = routes
      .filter((r) => !MESSENGER_ROUTES.includes(r.key))
      .filter((r) => {
        const roles = JSON.stringify(sorted(r.roles));
        return ![STAFF, STAFF_RECEPTION, ADMIN]
          .map((s) => JSON.stringify([...s].sort()))
          .includes(roles);
      })
      .map((r) => `${r.key}: ${sorted(r.roles).join(',')}`);
    expect(unexpected).toEqual([]);
  });

  it.each([
    'POST lab/orders/:orderId/approve-release',
    'POST lab/orders/:orderId/request-corrections',
    'POST lab/orders/:orderId/amendments/:amendmentId/approve',
    'POST lab/releases/:releaseId/artifacts/pdf/retry',
    'PATCH lab/users/:userId/role',
  ])('%s stays ADMIN/OWNER only', (key) => {
    const route = routes.find((r) => r.key === key);
    expect(sorted(route?.roles)).toEqual(ADMIN);
  });

  describe('enforced by LabTenantGuard for a messenger', () => {
    const guardFor = (role: string) =>
      new LabTenantGuard(
        {
          userTenantMembership: {
            findUnique: jest.fn().mockResolvedValue({
              role,
              status: 'ACTIVE',
              canPerformPickups: false,
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

    const prohibited = routes.filter((r) => !MESSENGER_ROUTES.includes(r.key));

    it.each(prohibited.map((r) => [r.key, r] as const))(
      'MESSENGER → 403 on %s',
      async (_key, route) => {
        await expect(
          guardFor('MESSENGER').canActivate(contextFor(route))
        ).rejects.toThrow(ForbiddenException);
      }
    );

    it.each(
      routes
        .filter((r) => MESSENGER_ROUTES.includes(r.key))
        .map((r) => [r.key, r] as const)
    )('MESSENGER → allowed on %s', async (_key, route) => {
      await expect(
        guardFor('MESSENGER').canActivate(contextFor(route))
      ).resolves.toBe(true);
    });

    it.each(
      routes
        .filter((r) => sorted(r.roles).includes('TECHNICIAN'))
        .map((r) => [r.key, r] as const)
    )('TECHNICIAN keeps access to %s', async (_key, route) => {
      await expect(
        guardFor('TECHNICIAN').canActivate(contextFor(route))
      ).resolves.toBe(true);
    });
  });
});
