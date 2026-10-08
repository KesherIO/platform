/**
 * Cross-app regression tests for the shared clinic profile.
 *
 * The lab portal (LabClientsService), clinic onboarding (OnboardingService),
 * clinic settings (TenantsService) and the clinic app's session data
 * (AuthService.getMe) all read and write the same Tenant row. These tests run
 * the real services against one small in-memory store, so a value written by
 * one app is what the other app's screen loads when it is reopened.
 */
import { ConfigService } from '@nestjs/config';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockReturnValue({ auth: { admin: {} } }),
}));

import { LabClientsService } from '../lab/lab-clients.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { TenantsService } from './tenants.service';
import { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { CompleteAdminOnboardingDto } from '../onboarding/dto/onboarding.dto';

type Row = Record<string, any>;

const LAB_ID = 'lab-1';
const ADMIN_USER_ID = 'admin-uid';

/** Relations the services select as lists — the store has none to return. */
const LIST_RELATIONS = new Set(['memberships', 'orders', 'clinicConnections']);

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && 'not' in value) {
      return row[key] !== value.not;
    }
    if (value !== null && typeof value === 'object') return true; // relation filters
    return (row[key] ?? null) === value;
  });
}

function makeStore() {
  const tenants = new Map<string, Row>([
    [LAB_ID, { id: LAB_ID, name: 'Kesher Lab', type: 'LAB' }],
  ]);
  const tokens: Row[] = [];
  const connections: Row[] = [];
  const memberships: Row[] = [];
  const orders: Row[] = [];
  let nextId = 1;

  const project = (row: Row, select?: Row): Row => {
    if (!select) return { ...row };
    const out: Row = {};
    for (const [key, value] of Object.entries(select)) {
      if (value === true) out[key] = row[key] ?? null;
      else if (key === '_count') {
        out[key] = {
          orders: orders.filter((o) => o.tenantId === row.id).length,
          memberships: memberships.filter((m) => m.tenantId === row.id).length,
        };
      } else if (LIST_RELATIONS.has(key)) out[key] = [];
    }
    return out;
  };

  const prisma: Row = {
    tenant: {
      findFirst: jest.fn(async () => null), // no email/slug conflicts
      findUnique: jest.fn(async ({ where, select }: Row) => {
        const row = tenants.get(where.id);
        return row ? project(row, select) : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where, select }: Row) => {
        const row = tenants.get(where.id);
        if (!row) throw new Error('not found');
        return project(row, select);
      }),
      create: jest.fn(async ({ data }: Row) => {
        const row = { id: `clinic-${nextId++}`, ...data };
        tenants.set(row.id, row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data, select }: Row) => {
        const row = tenants.get(where.id)!;
        Object.assign(row, data);
        return project(row, select);
      }),
      delete: jest.fn(async ({ where }: Row) => {
        tenants.delete(where.id);
        // onboarding_tokens.clinicTenantId FK: ON DELETE SET NULL
        for (const t of tokens) {
          if (t.clinicTenantId === where.id) t.clinicTenantId = null;
        }
      }),
    },
    clinicLabConnection: {
      create: jest.fn(async ({ data }: Row) => connections.push({ ...data })),
      findFirst: jest.fn(
        async ({ where }: Row) =>
          connections.find((c) => matches(c, where)) ?? null
      ),
      count: jest.fn(
        async ({ where }: Row) =>
          connections.filter((c) => matches(c, where)).length
      ),
      deleteMany: jest.fn(async ({ where }: Row) => {
        const keep = connections.filter((c) => !matches(c, where));
        connections.splice(0, connections.length, ...keep);
      }),
    },
    onboardingToken: {
      create: jest.fn(async ({ data }: Row) => {
        const row = {
          id: `token-${nextId++}`,
          used: false,
          usedAt: null,
          revokedAt: null,
          token: null,
          createdAt: new Date(),
          ...data,
        };
        tokens.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: Row) => {
        const found = tokens.filter((t) => matches(t, where));
        return found.length ? { ...found[found.length - 1] } : null;
      }),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async ({ where, data }: Row) =>
        Object.assign(tokens.find((t) => t.id === where.id)!, data)
      ),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const found = tokens.filter((t) => matches(t, where));
        found.forEach((t) => Object.assign(t, data));
        return { count: found.length };
      }),
    },
    user: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: Row) => data),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      findUniqueOrThrow: jest.fn(async ({ where, select }: Row) => ({
        id: where.id,
        email: 'admin@cityvet.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
        createdAt: new Date(),
        veterinarianProfile: null,
        memberships: memberships
          .filter((m) => m.userId === where.id)
          .map((m) => ({
            role: m.role,
            status: 'ACTIVE',
            isOrderingVet: false,
            createdAt: new Date(),
            tenant: project(
              tenants.get(m.tenantId)!,
              select.memberships.select.tenant.select
            ),
          })),
      })),
    },
    userTenantMembership: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: Row) => memberships.push({ ...data })),
      count: jest.fn(
        async ({ where }: Row) =>
          memberships.filter((m) => matches(m, where)).length
      ),
    },
    order: {
      count: jest.fn(
        async ({ where }: Row) => orders.filter((o) => matches(o, where)).length
      ),
    },
    $queryRaw: jest.fn(async () => []), // row lock — no-op in memory
    $transaction: jest.fn(async (fn: (tx: Row) => Promise<unknown>) =>
      fn(prisma)
    ),
  };

  return { prisma, tenants, tokens, memberships, orders };
}

/** Raw token from an onboarding link like `/onboarding/welcome?token=abc`. */
const tokenFromLink = (link: string) =>
  new URL(link, 'http://x').searchParams.get('token')!;

const LAB_ENTERED = {
  name: 'City Vet Clinic',
  clientType: 'VETERINARY_CLINIC',
  primaryContactName: 'Dr. Ana Gómez',
  primaryContactEmail: 'info@cityvet.com',
  phone: '+57 300 111 2222',
  address: 'Calle 10 #20-30',
  city: 'Bogotá',
  country: 'CO',
};

describe('Shared clinic profile across lab portal, onboarding and clinic app', () => {
  let store: ReturnType<typeof makeStore>;
  let lab: LabClientsService;
  let onboarding: OnboardingService;
  let clinicSettings: TenantsService;
  let clinicSession: AuthService;

  beforeEach(() => {
    store = makeStore();
    const prisma = store.prisma as unknown as PrismaService;
    const storage = {} as StorageService;
    const config = {
      getOrThrow: (key: string) =>
        key === 'SUPABASE_URL' ? 'http://localhost:54321' : 'test-key',
    } as unknown as ConfigService;

    clinicSession = new AuthService(prisma, config);
    jest
      .spyOn(clinicSession, 'createSupabaseUser')
      .mockResolvedValue(ADMIN_USER_ID);

    lab = new LabClientsService(prisma);
    onboarding = new OnboardingService(prisma, clinicSession, storage);
    clinicSettings = new TenantsService(prisma, storage);
  });

  /**
   * What the Angular wizard submits when the admin accepts the prefilled
   * clinic step unchanged: only fields that differ from the record are sent,
   * so no profile field at all.
   */
  function untouchedCompletion(
    token: string,
    changes: Partial<CompleteAdminOnboardingDto> = {}
  ): CompleteAdminOnboardingDto {
    return {
      token,
      adminFirstName: 'Jane',
      adminLastName: 'Doe',
      adminEmail: 'admin@cityvet.com',
      password: 'password1234',
      notificationMethod: 'email',
      ...changes,
    };
  }

  async function onboardLabClient() {
    const { clientId, onboardingLink } = await lab.createClient(
      LAB_ID,
      LAB_ENTERED,
      'lab-user'
    );
    const token = tokenFromLink(onboardingLink);
    await onboarding.verifyOnboardingToken(token);
    await onboarding.completeAdminOnboarding(untouchedCompletion(token));
    return clientId;
  }

  const LAB_ENTERED_DETAIL = {
    primaryContactName: 'Dr. Ana Gómez',
    primaryContactEmail: 'info@cityvet.com',
    phone: '+57 300 111 2222',
    address: 'Calle 10 #20-30',
    city: 'Bogotá',
    country: 'CO',
  };

  it('lab-entered details appear in onboarding and survive completion', async () => {
    const { clientId, onboardingLink } = await lab.createClient(
      LAB_ID,
      LAB_ENTERED,
      'lab-user'
    );
    const token = tokenFromLink(onboardingLink);

    const verify = await onboarding.verifyOnboardingToken(token);
    expect(verify).toMatchObject({
      valid: true,
      clinic: {
        name: 'City Vet Clinic',
        email: 'info@cityvet.com',
        primaryContactName: 'Dr. Ana Gómez',
        phone: '+57 300 111 2222',
        address: 'Calle 10 #20-30',
        city: 'Bogotá',
        country: 'CO',
      },
    });

    await onboarding.completeAdminOnboarding(untouchedCompletion(token));

    const detail = await lab.getClientDetail(LAB_ID, clientId);
    expect(detail).toMatchObject({
      status: 'ACTIVE',
      name: 'City Vet Clinic',
      ...LAB_ENTERED_DETAIL,
    });
    expect(store.tenants.size).toBe(2); // lab + this clinic — no duplicate
  });

  it('onboarding writes only what the admin changed and keeps the rest', async () => {
    const { clientId, onboardingLink } = await lab.createClient(
      LAB_ID,
      LAB_ENTERED,
      'lab-user'
    );
    const token = tokenFromLink(onboardingLink);
    await onboarding.verifyOnboardingToken(token);

    await onboarding.completeAdminOnboarding(
      untouchedCompletion(token, { clinicCity: 'Cali' })
    );

    expect(await lab.getClientDetail(LAB_ID, clientId)).toMatchObject({
      ...LAB_ENTERED_DETAIL,
      city: 'Cali',
    });
  });

  it('a lab edit made while the admin is in the wizard is not overwritten', async () => {
    const { clientId, onboardingLink } = await lab.createClient(
      LAB_ID,
      LAB_ENTERED,
      'lab-user'
    );
    const token = tokenFromLink(onboardingLink);
    await onboarding.verifyOnboardingToken(token); // wizard prefilled

    await lab.updateClient(LAB_ID, clientId, { phone: '+57 320 555 0000' });
    await onboarding.completeAdminOnboarding(untouchedCompletion(token));

    expect(await lab.getClientDetail(LAB_ID, clientId)).toMatchObject({
      phone: '+57 320 555 0000',
      address: 'Calle 10 #20-30',
      city: 'Bogotá',
    });
  });

  it('a clinic settings change appears when the lab reopens the client', async () => {
    const clientId = await onboardLabClient();

    await clinicSettings.updateClinic(clientId, {
      phone: '+57 310 999 8888',
      city: 'Medellín',
      primaryContactName: '', // intentionally cleared
    });

    const detail = await lab.getClientDetail(LAB_ID, clientId);
    expect(detail).toMatchObject({
      phone: '+57 310 999 8888',
      city: 'Medellín',
      primaryContactName: null,
      // untouched fields kept
      address: 'Calle 10 #20-30',
      country: 'CO',
      primaryContactEmail: 'info@cityvet.com',
    });
  });

  it('a lab change appears when the clinic app reloads its session', async () => {
    const clientId = await onboardLabClient();

    await lab.updateClient(LAB_ID, clientId, {
      address: 'Carrera 7 #45-10',
      country: 'MX',
      primaryContactName: 'Dr. Luis Pérez',
    });

    const me = await clinicSession.getMe(ADMIN_USER_ID);
    expect(me.memberships[0].tenant).toMatchObject({
      id: clientId,
      address: 'Carrera 7 #45-10',
      country: 'MX',
      primaryContactName: 'Dr. Luis Pérez',
      // untouched fields kept
      phone: '+57 300 111 2222',
      city: 'Bogotá',
    });
  });

  it("changing a pending client's email does not break invitation management", async () => {
    const { clientId, onboardingLink } = await lab.createClient(
      LAB_ID,
      LAB_ENTERED,
      'lab-user'
    );
    const oldToken = tokenFromLink(onboardingLink);

    await lab.updateClient(LAB_ID, clientId, {
      primaryContactEmail: 'frontdesk@cityvet.com',
    });

    let detail = await lab.getClientDetail(LAB_ID, clientId);
    expect(detail.invitation).toMatchObject({
      email: 'frontdesk@cityvet.com',
      revokedAt: null,
    });
    expect(await onboarding.verifyOnboardingToken(oldToken)).toMatchObject({
      valid: true,
      clinicEmail: 'frontdesk@cityvet.com',
    });

    const { onboardingLink: newLink } = await lab.regenerateInvitation(
      LAB_ID,
      clientId,
      'lab-user'
    );
    expect(await onboarding.verifyOnboardingToken(oldToken)).toEqual({
      valid: false,
      reason: 'revoked',
    });

    await expect(lab.revokeInvitation(LAB_ID, clientId)).resolves.toEqual({
      revoked: 1,
    });
    expect(
      await onboarding.verifyOnboardingToken(tokenFromLink(newLink))
    ).toEqual({ valid: false, reason: 'revoked' });

    detail = await lab.getClientDetail(LAB_ID, clientId);
    expect(detail.invitation?.revokedAt).toBeInstanceOf(Date);
  });

  it("deleting one client revokes only that client's invitations", async () => {
    const a = await lab.createClient(LAB_ID, LAB_ENTERED, 'lab-user');
    const b = await lab.createClient(
      LAB_ID,
      { ...LAB_ENTERED, name: 'Other Clinic', primaryContactEmail: 'b@x.com' },
      'lab-user'
    );

    await lab.deleteClient(LAB_ID, a.clientId);

    expect(
      await onboarding.verifyOnboardingToken(tokenFromLink(a.onboardingLink))
    ).toEqual({ valid: false, reason: 'revoked' });
    expect(
      await onboarding.verifyOnboardingToken(tokenFromLink(b.onboardingLink))
    ).toMatchObject({ valid: true, clinicName: 'Other Clinic' });
  });

  describe('deletion guards', () => {
    it('refuses to delete an onboarded clinic and leaves its users and memberships intact', async () => {
      const clientId = await onboardLabClient();

      await expect(lab.deleteClient(LAB_ID, clientId)).rejects.toThrow(
        /completed onboarding/
      );

      expect(store.tenants.has(clientId)).toBe(true);
      expect(store.prisma.user.delete).not.toHaveBeenCalled();
      expect(store.prisma.user.deleteMany).not.toHaveBeenCalled();
      const me = await clinicSession.getMe(ADMIN_USER_ID);
      expect(me.memberships.map((m) => m.tenant.id)).toEqual([clientId]);
    });

    it('refuses to delete a pending clinic that already has an order', async () => {
      const { clientId, onboardingLink } = await lab.createClient(
        LAB_ID,
        LAB_ENTERED,
        'lab-user'
      );
      store.orders.push({ id: 'order-1', tenantId: clientId });

      await expect(lab.deleteClient(LAB_ID, clientId)).rejects.toThrow(
        /existing orders/
      );
      expect(store.tenants.has(clientId)).toBe(true);
      expect(
        await onboarding.verifyOnboardingToken(tokenFromLink(onboardingLink))
      ).toMatchObject({ valid: true }); // invitation not revoked
    });

    it("never touches a user's memberships in other clinics", async () => {
      // The lab's contact for clinic A also administers clinic B.
      const clinicB = await onboardLabClient();
      const a = await lab.createClient(
        LAB_ID,
        { ...LAB_ENTERED, name: 'Clinic A', primaryContactEmail: 'a@x.com' },
        'lab-user'
      );

      await lab.deleteClient(LAB_ID, a.clientId);

      expect(store.tenants.has(a.clientId)).toBe(false);
      expect(store.prisma.user.delete).not.toHaveBeenCalled();
      expect(store.prisma.user.deleteMany).not.toHaveBeenCalled();
      expect(store.memberships).toEqual([
        expect.objectContaining({ userId: ADMIN_USER_ID, tenantId: clinicB }),
      ]);
    });
  });
});
