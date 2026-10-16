/**
 * Signer ↔ team link against a real Postgres: analysts must be team members
 * and drop off the analyst list once removed; link changes are audited.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set (throwaway database only,
 * see result-entry.batch.int.spec.ts).
 */
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { TenantRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthService } from '../auth/auth.service';
import type { OrderStatusService } from './order-status.service';
import { LabService } from './lab.service';
import { LabUsersService } from './lab-users.service';
import { ReviewService } from './review.service';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

describeWithDb('Signer team link against Postgres', () => {
  let prisma: PrismaService;
  let lab: LabService;
  let users: LabUsersService;
  let review: ReviewService;
  let labId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService({
      getOrThrow: () => DATABASE_URL,
    } as unknown as ConfigService);
    await prisma.$connect();
    lab = new LabService(prisma, {} as OrderStatusService);
    users = new LabUsersService(prisma, {} as AuthService);
    review = new ReviewService(prisma);
  });

  beforeEach(async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: 'IT signers',
        slug: `it-sign-${randomUUID()}`,
        type: 'LAB',
      },
    });
    labId = tenant.id;
  });

  afterEach(async () => {
    await prisma.tenant.delete({ where: { id: labId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function member(role: TenantRole, firstName: string) {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `it-${randomUUID()}@it.example.com`,
        firstName,
      },
    });
    userIds.push(user.id);
    await prisma.userTenantMembership.create({
      data: { userId: user.id, tenantId: labId, role },
    });
    return user.id;
  }

  const save = (
    actor: string,
    signers: {
      id?: string;
      userId?: string | null;
      name: string;
      roles: string[];
    }[]
  ) => lab.upsertLaboratoryProfile(labId, { signers }, actor);

  it('a linked analyst leaves the analyst list when removed from the team', async () => {
    const admin = await member('ADMIN', 'Admin');
    const tech = await member('ANALYST', 'Juan');

    await save(admin, [
      { id: 'temp-1', userId: tech, name: 'Juan', roles: ['ANALYST'] },
      { id: 'temp-2', name: 'Director', roles: ['REVIEWER'] },
    ]);
    expect((await review.getAnalystSigners(labId)).map((s) => s.name)).toEqual([
      'Juan',
    ]);

    await users.removeMember(labId, tech, 'left', admin, TenantRole.ADMIN);

    expect(await review.getAnalystSigners(labId)).toEqual([]);
    // The reviewer without an account is unaffected
    expect((await review.getReviewerSigners(labId)).map((s) => s.name)).toEqual(
      ['Director']
    );
    // Settings still save with the unchanged link to the removed member
    const profile = await lab.getLaboratoryProfile(labId);
    await expect(
      save(
        admin,
        (profile?.signers ?? []).map((s) => ({
          id: s.id,
          userId: s.userId,
          name: s.name,
          roles: s.roles,
        }))
      )
    ).resolves.toBeTruthy();
  });

  it('rejects an unlinked analyst and writes nothing', async () => {
    const admin = await member('ADMIN', 'Admin');

    await expect(
      save(admin, [{ id: 'temp-1', name: 'Nobody', roles: ['ANALYST'] }])
    ).rejects.toThrow('must be linked to a team member');
    expect(
      await prisma.labSigner.count({
        where: { laboratoryProfile: { tenantId: labId } },
      })
    ).toBe(0);
  });

  it('records link changes in the team history', async () => {
    const admin = await member('ADMIN', 'Admin');
    const a = await member('ANALYST', 'Ana');
    const b = await member('REVIEWER', 'Beto');

    const first = await save(admin, [
      { id: 'temp-1', userId: a, name: 'Firmante', roles: ['ANALYST'] },
    ]);
    const signerId = first?.signers[0].id as string;
    await save(admin, [
      {
        id: signerId,
        userId: b,
        name: 'Firmante',
        roles: ['ANALYST', 'REVIEWER'],
      },
    ]);

    const events = await prisma.membershipEvent.findMany({
      where: { tenantId: labId },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => [e.eventType, e.targetUserId])).toEqual([
      ['SIGNER_LINKED', a],
      ['SIGNER_UNLINKED', a],
      ['SIGNER_LINKED', b],
    ]);
    expect(events[0]).toMatchObject({
      actorUserId: admin,
      source: 'lab_settings',
      details: { signerId, signerName: 'Firmante', roles: ['ANALYST'] },
    });
  });
});
