import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import {
  analystSnapshotFields,
  findActiveAnalyst,
} from './analyst-signer.util';

describe('analyst-signer.util', () => {
  const analyst = {
    id: 'analyst-1',
    name: 'Ana Analyst',
    title: 'Bacterióloga',
    specialty: '',
    university: 'UdeA',
    registrationNumber: 'RN-9',
    signatureUrl: null,
  };

  function prismaWith(result: unknown) {
    const findFirst = jest.fn().mockResolvedValue(result);
    return {
      prisma: { labSigner: { findFirst } } as unknown as Pick<
        PrismaService,
        'labSigner'
      >,
      findFirst,
    };
  }

  describe('findActiveAnalyst', () => {
    it('returns null without querying when no analyst was picked', async () => {
      const { prisma, findFirst } = prismaWith(analyst);

      await expect(
        findActiveAnalyst(prisma, 'lab-1', undefined)
      ).resolves.toBeNull();
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('looks up an ANALYST signer of this lab linked to an active member', async () => {
      const { prisma, findFirst } = prismaWith(analyst);

      await expect(
        findActiveAnalyst(prisma, 'lab-1', 'analyst-1')
      ).resolves.toEqual(analyst);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'analyst-1',
            laboratoryProfile: { tenantId: 'lab-1' },
            roles: { has: 'ANALYST' },
            user: {
              memberships: {
                some: { tenantId: 'lab-1', status: 'ACTIVE' },
              },
            },
          },
        })
      );
    });

    it('throws NotFoundException when the analyst does not qualify', async () => {
      const { prisma } = prismaWith(null);

      await expect(
        findActiveAnalyst(prisma, 'lab-1', 'analyst-of-lab-b')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('analystSnapshotFields', () => {
    it('maps the analyst, turning empty strings into null', () => {
      expect(analystSnapshotFields(analyst)).toEqual({
        analystId: 'analyst-1',
        analystName: 'Ana Analyst',
        analystTitle: 'Bacterióloga',
        analystSpecialty: null,
        analystUniversity: 'UdeA',
        analystRegistrationNumber: 'RN-9',
        analystSignatureUrl: null,
      });
    });

    it('is all null without an analyst', () => {
      expect(Object.values(analystSnapshotFields(null))).toEqual(
        Array(7).fill(null)
      );
    });
  });
});
