/**
 * Explicit role matrix for the analyzer routes, enforced by the REAL LabTenantGuard for every role.
 * Patient data and quality decisions live here, so each route lists exactly who may call it:
 *
 *   read queue / message / RAW download ........ staff  (Analyst, Reviewer, Admin, Owner)
 *   link a sample, reprocess, dismiss .......... staff
 *   approve (changed result / expired reagent) . Reviewer, Admin, Owner  — not the Analyst
 *   mappings + connector credentials (write) ... Admin, Owner
 *   everyone else — Messenger, Consulta (results viewer), retired lab roles, clinic roles — is refused everywhere.
 *
 * A route added to the controller without a row here fails the first test.
 */
import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantRole } from '@vet-ai/shared-types';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import type { PrismaService } from '../prisma/prisma.service';
import { InstrumentReviewController } from './instrument-review.controller';

const STAFF = ['ANALYST', 'REVIEWER', 'ADMIN', 'OWNER'];
const RELEASE = ['REVIEWER', 'ADMIN', 'OWNER'];
const ADMIN = ['ADMIN', 'OWNER'];

/** route key → exactly the roles allowed */
const MATRIX: Record<string, string[]> = {
  // reading, including patient data and the raw message
  'GET lab/instruments/summary': STAFF,
  'GET lab/instruments/messages': STAFF,
  'GET lab/instruments/messages/:id': STAFF,
  'GET lab/instruments/messages/:id/raw': STAFF,
  // acting on a message
  'POST lab/instruments/messages/:id/resolve-sample': STAFF, // links a sample to an order
  'POST lab/instruments/messages/:id/reprocess': STAFF,
  'POST lab/instruments/messages/:id/dismiss': STAFF,
  'POST lab/instruments/messages/:id/approve': RELEASE,
  // sample links
  'GET lab/instruments/sample-links': STAFF,
  'POST lab/instruments/sample-links': STAFF,
  'POST lab/instruments/sample-links/:id/end': STAFF,
  // configuration
  'GET lab/instruments/mappings': STAFF,
  'PUT lab/instruments/mappings': ADMIN,
  'DELETE lab/instruments/mappings/:id': ADMIN,
  'GET lab/instruments/credentials': ADMIN,
  'POST lab/instruments/credentials': ADMIN,
  'POST lab/instruments/credentials/:id/revoke': ADMIN,
};

type Route = {
  key: string;
  handler: (...a: unknown[]) => unknown;
  roles: string[] | undefined;
};
const C = InstrumentReviewController;
const base = Reflect.getMetadata(PATH_METADATA, C) as string;

const routes: Route[] = Object.getOwnPropertyNames(C.prototype)
  .filter(
    (n) =>
      n !== 'constructor' &&
      Reflect.getMetadata(
        PATH_METADATA,
        C.prototype[n as keyof typeof C.prototype]
      ) !== undefined
  )
  .map((n) => {
    const handler = C.prototype[
      n as keyof typeof C.prototype
    ] as unknown as Route['handler'];
    const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)];
    return {
      key: `${method} ${`${base}/${Reflect.getMetadata(
        PATH_METADATA,
        handler
      )}`.replace(/\/+/g, '/')}`,
      handler,
      roles:
        Reflect.getMetadata(ROLES_KEY, handler) ??
        Reflect.getMetadata(ROLES_KEY, C),
    };
  });

const ALL_ROLES = Object.values(TenantRole) as string[];

function guardFor(
  role: string,
  over: { status?: string; tenantType?: string } = {}
) {
  return new LabTenantGuard(
    {
      userTenantMembership: {
        findUnique: jest.fn().mockResolvedValue({
          role,
          status: over.status ?? 'ACTIVE',
          canPerformPickups: role === 'MESSENGER',
          canViewInProgress: true, // even Consulta's "view in progress" box must not open these routes
          tenant: {
            id: 'lab-1',
            name: 'Lab',
            logoUrl: null,
            type: over.tenantType ?? 'LAB',
          },
        }),
      },
    } as unknown as PrismaService,
    new Reflector()
  );
}
const contextFor = (route: Route) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 'u1' },
        headers: { 'x-tenant-id': 'lab-1' },
      }),
    }),
    getHandler: () => route.handler,
    getClass: () => C,
  } as unknown as ExecutionContext);

describe('analyzer routes: explicit role matrix', () => {
  it('the controller is behind LabTenantGuard and every route is in the matrix (and vice versa)', () => {
    expect(
      (Reflect.getMetadata(GUARDS_METADATA, C) as { name: string }[]).map(
        (g) => g.name
      )
    ).toContain('LabTenantGuard');
    expect(routes.map((r) => r.key).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  it.each(routes.map((r) => [r.key, r] as const))(
    '%s declares exactly the roles in the matrix',
    (key, route) => {
      expect([...(route.roles ?? [])].sort()).toEqual([...MATRIX[key]].sort());
    }
  );

  // The real guard, every role × every route: allowed iff the matrix says so.
  describe.each(routes.map((r) => [r.key, r] as const))('%s', (key, route) => {
    it.each(ALL_ROLES)('%s', async (role) => {
      const outcome = guardFor(role).canActivate(contextFor(route));
      if (MATRIX[key].includes(role)) await expect(outcome).resolves.toBe(true);
      else await expect(outcome).rejects.toThrow(ForbiddenException);
    });
  });

  it('messengers are refused on every analyzer route', async () => {
    for (const route of routes) {
      await expect(
        guardFor('MESSENGER').canActivate(contextFor(route))
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('Consulta (results viewer) is refused everywhere, including raw message download and the queue', async () => {
    for (const route of routes) {
      await expect(
        guardFor('RESULTS_VIEWER').canActivate(contextFor(route))
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('an Analyst cannot approve, edit mappings or manage credentials', async () => {
    for (const key of [
      'POST lab/instruments/messages/:id/approve',
      'PUT lab/instruments/mappings',
      'DELETE lab/instruments/mappings/:id',
      'POST lab/instruments/credentials',
      'POST lab/instruments/credentials/:id/revoke',
      'GET lab/instruments/credentials',
    ]) {
      const route = routes.find((r) => r.key === key) as Route;
      await expect(
        guardFor('ANALYST').canActivate(contextFor(route))
      ).rejects.toThrow(ForbiddenException);
    }
  });

  it('even an Owner is refused when the membership is not active or the tenant is a clinic', async () => {
    const approve = routes.find(
      (r) => r.key === 'POST lab/instruments/messages/:id/approve'
    ) as Route;
    await expect(
      guardFor('OWNER', { status: 'SUSPENDED' }).canActivate(
        contextFor(approve)
      )
    ).rejects.toThrow(ForbiddenException);
    await expect(
      guardFor('OWNER', { tenantType: 'CLINIC' }).canActivate(
        contextFor(approve)
      )
    ).rejects.toThrow(ForbiddenException);
  });
});
