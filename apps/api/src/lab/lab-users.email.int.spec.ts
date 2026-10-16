/**
 * Team page email/profile edits against a real Postgres: the Supabase login is
 * changed before our row, a failed DB write puts the login back, owner
 * protection holds, and every change lands in the team history once.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set (throwaway database only,
 * see result-entry.batch.int.spec.ts).
 */
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { TenantRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthService } from '../auth/auth.service';
import { LabUsersService } from './lab-users.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Lab member email/profile edits against Postgres', () => {
  let prisma: PrismaService;
  let service: LabUsersService;
  let labId: string;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  const updateSupabaseUserEmail = jest.fn();

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    service = new LabUsersService(prisma, {
      updateSupabaseUserEmail,
    } as unknown as AuthService);
  });

  beforeEach(async () => {
    updateSupabaseUserEmail.mockReset().mockResolvedValue(undefined);
    labId = await tenant('LAB');
  });

  afterEach(async () => {
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    tenantIds.length = 0;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function tenant(type: 'LAB' | 'CLINIC') {
    const t = await prisma.tenant.create({
      data: { name: 'IT email', slug: `it-email-${randomUUID()}`, type },
    });
    tenantIds.push(t.id);
    return t.id;
  }

  async function member(role: TenantRole, tenantId = labId) {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `it-${randomUUID()}@it.example.com`,
        firstName: 'Jane',
      },
    });
    userIds.push(user.id);
    await prisma.userTenantMembership.create({
      data: { userId: user.id, tenantId, role },
    });
    return user;
  }

  const events = (targetUserId: string) =>
    prisma.membershipEvent.findMany({
      where: { tenantId: labId, targetUserId },
      orderBy: { createdAt: 'asc' },
    });

  it('changes the login, then the row, and logs EMAIL_CHANGED', async () => {
    const admin = await member('ADMIN');
    const tech = await member('ANALYST');
    const newEmail = `new-${randomUUID()}@it.example.com`;

    await service.updateUser(
      labId,
      tech.id,
      { email: newEmail.toUpperCase() },
      admin.id,
      TenantRole.ADMIN
    );

    expect(updateSupabaseUserEmail).toHaveBeenCalledWith(tech.id, newEmail);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: tech.id } });
    expect(row.email).toBe(newEmail);
    const [event] = await events(tech.id);
    expect(event).toMatchObject({
      eventType: 'EMAIL_CHANGED',
      actorUserId: admin.id,
      targetEmail: newEmail,
      details: { previousEmail: tech.email, newEmail },
    });
  });

  it('a DB conflict puts the login back and logs nothing', async () => {
    const admin = await member('ADMIN');
    const tech = await member('ANALYST');
    const other = await member('ANALYST');
    // Someone else takes the address after the pre-check (during the
    // Supabase call), so our write hits the unique constraint.
    updateSupabaseUserEmail.mockImplementationOnce(async () => {
      await prisma.user.update({
        where: { id: other.id },
        data: { email: 'race@it.example.com' },
      });
    });

    await expect(
      service.updateUser(
        labId,
        tech.id,
        { email: 'race@it.example.com' },
        admin.id,
        TenantRole.ADMIN
      )
    ).rejects.toThrow('A user with this email already exists.');

    expect(updateSupabaseUserEmail).toHaveBeenLastCalledWith(
      tech.id,
      tech.email
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { id: tech.id } });
    expect(row.email).toBe(tech.email);
    expect(await events(tech.id)).toHaveLength(0);
  });

  it("an admin can't edit an owner; an owner can", async () => {
    const admin = await member('ADMIN');
    const owner = await member('OWNER');
    const owner2 = await member('OWNER');

    await expect(
      service.updateUser(
        labId,
        owner.id,
        { firstName: 'X' },
        admin.id,
        TenantRole.ADMIN
      )
    ).rejects.toThrow(ForbiddenException);

    await service.updateUser(
      labId,
      owner.id,
      { firstName: 'Ana' },
      owner2.id,
      TenantRole.OWNER
    );
    const [event] = await events(owner.id);
    expect(event).toMatchObject({
      eventType: 'PROFILE_CHANGED',
      actorUserId: owner2.id,
      details: { changes: { firstName: { from: 'Jane', to: 'Ana' } } },
    });
  });

  it('refuses an email change for someone in another tenant', async () => {
    const admin = await member('ADMIN');
    const vet = await member('ANALYST');
    await prisma.userTenantMembership.create({
      data: { userId: vet.id, tenantId: await tenant('CLINIC'), role: 'VET' },
    });

    await expect(
      service.updateUser(
        labId,
        vet.id,
        { email: `x-${randomUUID()}@it.example.com` },
        admin.id,
        TenantRole.ADMIN
      )
    ).rejects.toThrow(ForbiddenException);
    expect(updateSupabaseUserEmail).not.toHaveBeenCalled();
  });

  it('the same edit sent twice at once is logged once', async () => {
    const admin = await member('ADMIN');
    const tech = await member('ANALYST');

    await Promise.all([
      service.updateUser(
        labId,
        tech.id,
        { firstName: 'Ana' },
        admin.id,
        TenantRole.ADMIN
      ),
      service.updateUser(
        labId,
        tech.id,
        { firstName: 'Ana' },
        admin.id,
        TenantRole.ADMIN
      ),
    ]);

    expect(await events(tech.id)).toHaveLength(1);
  });
});
