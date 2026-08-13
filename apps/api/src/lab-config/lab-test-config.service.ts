import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertLabTestConfigDto } from './dto/lab-config.dto';

@Injectable()
export class LabTestConfigService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly include = {
    catalogItem: { select: { id: true, name: true, code: true, kind: true } },
    defaultAnalyzer: { select: { id: true, name: true, department: true } },
    specimenRequirements: { orderBy: { sortOrder: 'asc' as const } },
  };

  async listConfigs(labTenantId: string) {
    return this.prisma.labTestConfiguration.findMany({
      where: { labTenantId },
      include: this.include,
      orderBy: { catalogItem: { name: 'asc' } },
    });
  }

  async getConfig(labTenantId: string, id: string) {
    const config = await this.prisma.labTestConfiguration.findFirst({
      where: { id, labTenantId },
      include: this.include,
    });
    if (!config) throw new NotFoundException('Test configuration not found');
    return config;
  }

  async upsertConfig(labTenantId: string, dto: UpsertLabTestConfigDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.labTestConfiguration.findUnique({
        where: {
          labTenantId_catalogItemId: {
            labTenantId,
            catalogItemId: dto.catalogItemId,
          },
        },
      });

      if (existing) {
        if (dto.specimenRequirements) {
          await tx.labTestSpecimenRequirement.deleteMany({
            where: { labTestConfigurationId: existing.id },
          });
        }

        return tx.labTestConfiguration.update({
          where: { id: existing.id },
          data: {
            department: dto.department,
            ...(dto.defaultProcessingMethod !== undefined && {
              defaultProcessingMethod: dto.defaultProcessingMethod,
            }),
            ...(dto.allowedProcessingMethods !== undefined && {
              allowedProcessingMethods: dto.allowedProcessingMethods,
            }),
            ...(dto.defaultAnalyzerId !== undefined && {
              defaultAnalyzerId: dto.defaultAnalyzerId || null,
            }),
            ...(dto.specimenRequirements && {
              specimenRequirements: {
                create: dto.specimenRequirements.map((sr, i) => ({
                  specimenType: sr.specimenType,
                  containerType: sr.containerType,
                  minimumVolumeMl: sr.minimumVolumeMl,
                  requirementGroupKey: sr.requirementGroupKey,
                  specimenRole: sr.specimenRole,
                  isAlternativeWithinGroup: sr.isAlternativeWithinGroup ?? false,
                  notes: sr.notes,
                  sortOrder: sr.sortOrder ?? i,
                })),
              },
            }),
          },
          include: this.include,
        });
      }

      return tx.labTestConfiguration.create({
        data: {
          labTenantId,
          catalogItemId: dto.catalogItemId,
          department: dto.department,
          defaultProcessingMethod: dto.defaultProcessingMethod ?? 'MANUAL',
          allowedProcessingMethods: dto.allowedProcessingMethods ?? [
            dto.defaultProcessingMethod ?? 'MANUAL',
          ],
          defaultAnalyzerId: dto.defaultAnalyzerId || null,
          ...(dto.specimenRequirements && {
            specimenRequirements: {
              create: dto.specimenRequirements.map((sr, i) => ({
                specimenType: sr.specimenType,
                containerType: sr.containerType,
                minimumVolumeMl: sr.minimumVolumeMl,
                requirementGroupKey: sr.requirementGroupKey,
                specimenRole: sr.specimenRole,
                isAlternativeWithinGroup: sr.isAlternativeWithinGroup ?? false,
                notes: sr.notes,
                sortOrder: sr.sortOrder ?? i,
              })),
            },
          }),
        },
        include: this.include,
      });
    });
  }

  async deleteConfig(labTenantId: string, id: string) {
    await this.getConfig(labTenantId, id);
    await this.prisma.labTestConfiguration.delete({ where: { id } });
  }
}
