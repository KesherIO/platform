/**
 * Membership audit log against a real Postgres: events commit and roll back
 * with their change, and concurrent duplicates log once.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set (throwaway database only,
 * see result-entry.batch.int.spec.ts).
 */
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { TenantRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthService } from '../auth/auth.service';
import { LabUsersService } from './lab-users.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Membership audit log against Postgres', () => {
  let prisma: PrismaService;
  let service: LabUsersService;
  let labId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    service = new LabUsersService(prisma, {} as AuthService);
  });

  beforeEach(async () => {
    const lab = await prisma.tenant.create({
      data: { name: 'IT audit', slug: `it-audit-${randomUUID()}`, type: 'LAB' },
    });
    labId = lab.id;
  });

  afterEach(async () => {
    await prisma.tenant.delete({ where: { id: labId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function member(role: TenantRole) {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `it-${randomUUID()}@it.example.com`,
        firstName: 'It',
        lastName: role,
      },
    });
    userIds.push(user.id);
    await prisma.userTenantMembership.create({
      data: { userId: user.id, tenantId: labId, role },
    });
    return user.id;
  }

  const events = () =>
    prisma.membershipEvent.findMany({ where: { tenantId: labId } });

  it('the same role change sent twice at once is logged once', async () => {
    const admin = await member('ADMIN');
    const tech = await member('TECHNICIAN');

    await Promise.all([
      service.updateRole(labId, tech, 'ANALYST', 'r', admin, TenantRole.ADMIN),
      service.updateRole(labId, tech, 'ANALYST', 'r', admin, TenantRole.ADMIN),
    ]);

    const logged = await events();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      eventType: 'ROLE_CHANGED',
      previousRole: 'TECHNICIAN',
      newRole: 'ANALYST',
      actorUserId: admin,
      targetName: 'It TECHNICIAN',
    });
  });

  it('a removal sent twice at once is logged once', async () => {
    const admin = await member('ADMIN');
    const tech = await member('TECHNICIAN');

    const results = await Promise.allSettled([
      service.removeMember(labId, tech, 'left', admin, TenantRole.ADMIN),
      service.removeMember(labId, tech, 'left', admin, TenantRole.ADMIN),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await events()).toHaveLength(1);
  });

  it('a rejected change leaves no event', async () => {
    const owner = await member('OWNER');
    const admin = await member('ADMIN');

    await expect(
      service.updateRole(labId, owner, 'ADMIN', 'r', admin, TenantRole.ADMIN)
    ).rejects.toThrow('Only an owner');
    expect(await events()).toHaveLength(0);
  });

  it("a removed member's history stays readable", async () => {
    const admin = await member('ADMIN');
    const tech = await member('TECHNICIAN');
    await service.updateRole(
      labId,
      tech,
      'REVIEWER',
      'promo',
      admin,
      TenantRole.ADMIN
    );
    await service.removeMember(labId, tech, 'left', admin, TenantRole.ADMIN);

    const history = await service.getMembershipHistory(labId, {
      userId: tech,
    });
    expect(history.items.map((e) => e.eventType)).toEqual([
      'REMOVED',
      'ROLE_CHANGED',
    ]);
    expect(await service.getRemovedMembers(labId)).toEqual([
      expect.objectContaining({ userId: tech, lastRole: 'REVIEWER' }),
    ]);
  });
});
