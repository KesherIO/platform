/**
 * Owner protection against a real Postgres: two owners demoting each other
 * at the same time must not leave the lab without an owner.
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

describeWithDb('Owner protection against Postgres', () => {
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
      data: {
        name: 'IT owners',
        slug: `it-owners-${randomUUID()}`,
        type: 'LAB',
      },
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
      data: { id: randomUUID(), email: `it-${randomUUID()}@it.example.com` },
    });
    userIds.push(user.id);
    await prisma.userTenantMembership.create({
      data: { userId: user.id, tenantId: labId, role },
    });
    return user.id;
  }

  const owners = () =>
    prisma.userTenantMembership.count({
      where: { tenantId: labId, role: 'OWNER' },
    });

  it('two owners demoting each other at once: exactly one succeeds', async () => {
    const a = await member('OWNER');
    const b = await member('OWNER');

    const results = await Promise.allSettled([
      service.updateRole(labId, b, 'ADMIN', 'r', a, TenantRole.OWNER),
      service.updateRole(labId, a, 'ADMIN', 'r', b, TenantRole.OWNER),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await owners()).toBe(1);
  });

  it('two owners removing each other at once: exactly one succeeds', async () => {
    const a = await member('OWNER');
    const b = await member('OWNER');

    const results = await Promise.allSettled([
      service.removeMember(labId, b, 'r', a, TenantRole.OWNER),
      service.removeMember(labId, a, 'r', b, TenantRole.OWNER),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await owners()).toBe(1);
  });

  it('an admin cannot demote the owner', async () => {
    const owner = await member('OWNER');
    const admin = await member('ADMIN');

    await expect(
      service.updateRole(labId, owner, 'ADMIN', 'r', admin, TenantRole.ADMIN)
    ).rejects.toThrow('Only an owner');
    expect(await owners()).toBe(1);
  });
});
