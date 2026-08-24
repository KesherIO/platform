import { Injectable, NotFoundException } from '@nestjs/common';
import { Department } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertLabTestConfigDto } from './dto/lab-config.dto';

const CATEGORY_DEPARTMENT_MAP: Record<string, Department> = {
  // Spanish
  'hematología': 'HEMATOLOGY',
  'coagulación': 'HEMATOLOGY',
  'bioquímica': 'CHEMISTRY',
  'electrolitos': 'CHEMISTRY',
  'biología molecular': 'CHEMISTRY',
  'hormonas': 'ENDOCRINOLOGY',
  'endocrinología': 'ENDOCRINOLOGY',
  'serología': 'SEROLOGY',
  'urianálisis': 'URINALYSIS',
  'uroanálisis': 'URINALYSIS',
  'microbiología': 'MICROBIOLOGY',
  'coprología': 'PARASITOLOGY',
  'patología': 'OTHER',
  'citología': 'OTHER',
  'inmunohistoquímica': 'OTHER',
  'histoquímica': 'OTHER',
  'toxicología': 'OTHER',
  'fármacos': 'OTHER',
  // English
  'hematology': 'HEMATOLOGY',
  'coagulation': 'HEMATOLOGY',
  'biochemistry': 'CHEMISTRY',
  'chemistry': 'CHEMISTRY',
  'electrolytes': 'CHEMISTRY',
  'molecular biology': 'CHEMISTRY',
  'hormones': 'ENDOCRINOLOGY',
  'endocrinology': 'ENDOCRINOLOGY',
  'serology': 'SEROLOGY',
  'urinalysis': 'URINALYSIS',
  'microbiology': 'MICROBIOLOGY',
  'coprology': 'PARASITOLOGY',
  'parasitology': 'PARASITOLOGY',
  'pathology': 'OTHER',
  'cytology': 'OTHER',
  'immunohistochemistry': 'OTHER',
  'histochemistry': 'OTHER',
  'toxicology': 'OTHER',
  'pharmaceuticals': 'OTHER',
};

function mapCategoryToDepartment(category: string | null): Department {
  if (!category) return 'OTHER';
  return CATEGORY_DEPARTMENT_MAP[category.toLowerCase().trim()] ?? 'OTHER';
}

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
                  isAlternativeWithinGroup:
                    sr.isAlternativeWithinGroup ?? false,
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

  async generateConfigs(labTenantId: string) {
    const [unconfigured, totalActive] = await Promise.all([
      this.prisma.catalogItem.findMany({
        where: {
          labTenantId,
          kind: 'TEST',
          active: true,
          labTestConfigurations: { none: { labTenantId } },
        },
        select: { id: true, category: true },
      }),
      this.prisma.catalogItem.count({
        where: { labTenantId, kind: 'TEST', active: true },
      }),
    ]);

    const unmappedCategories = new Set<string>();
    const data = unconfigured.map((item) => {
      const department = mapCategoryToDepartment(item.category);
      if (
        item.category &&
        department === 'OTHER' &&
        !CATEGORY_DEPARTMENT_MAP[item.category.toLowerCase().trim()]
      ) {
        unmappedCategories.add(item.category);
      }
      return {
        labTenantId,
        catalogItemId: item.id,
        department,
        defaultProcessingMethod: 'MANUAL' as const,
        allowedProcessingMethods: ['MANUAL' as const],
      };
    });

    if (data.length > 0) {
      await this.prisma.labTestConfiguration.createMany({
        data,
        skipDuplicates: true,
      });
    }

    return {
      created: data.length,
      skipped: totalActive - data.length,
      unmappedCategories: Array.from(unmappedCategories),
    };
  }
}
