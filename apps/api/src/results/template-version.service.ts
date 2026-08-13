import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTemplateDefinitionDto,
  UpdateDraftVersionDto,
  TemplateSectionDto,
} from './dto/template-version.dto';
import type { PatientSpecies } from '@prisma/client';

const VERSION_INCLUDE = {
  sections: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      analytes: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
  analytes: { orderBy: { sortOrder: 'asc' as const } },
};

const DEFINITION_INCLUDE = {
  activeVersion: {
    include: VERSION_INCLUDE,
  },
};

@Injectable()
export class TemplateVersionService {
  constructor(private readonly prisma: PrismaService) {}

  async listDefinitions(
    labTenantId: string,
    filters?: { catalogItemCode?: string; species?: string }
  ) {
    const where: Record<string, unknown> = {
      OR: [{ scope: 'PLATFORM' }, { scope: 'LABORATORY', labTenantId }],
    };
    if (filters?.catalogItemCode) {
      where.catalogItemCode = filters.catalogItemCode;
    }
    if (filters?.species) {
      where.species = filters.species;
    }

    return this.prisma.resultTemplateDefinition.findMany({
      where,
      include: {
        activeVersion: {
          select: {
            id: true,
            version: true,
            title: true,
            status: true,
            publishedAt: true,
          },
        },
      },
      orderBy: [{ catalogItemCode: 'asc' }, { species: 'asc' }],
    });
  }

  async getDefinition(id: string) {
    const definition = await this.prisma.resultTemplateDefinition.findUnique({
      where: { id },
      include: {
        ...DEFINITION_INCLUDE,
        versions: {
          select: {
            id: true,
            version: true,
            status: true,
            title: true,
            publishedAt: true,
          },
          orderBy: { version: 'desc' },
        },
      },
    });
    if (!definition)
      throw new NotFoundException('Template definition not found');
    return definition;
  }

  async createDefinition(
    labTenantId: string,
    dto: CreateTemplateDefinitionDto
  ) {
    const ageMin = dto.ageMinWeeks ?? -1;
    const ageMax = dto.ageMaxWeeks ?? -1;

    return this.prisma.$transaction(async (tx) => {
      const definition = await tx.resultTemplateDefinition.create({
        data: {
          catalogItemCode: dto.catalogItemCode,
          species: dto.species,
          ageMinWeeks: ageMin,
          ageMaxWeeks: ageMax,
          scope: 'LABORATORY',
          labTenantId,
          ownerKey: labTenantId,
        },
      });

      const version = await tx.resultTemplateVersion.create({
        data: {
          definitionId: definition.id,
          version: 1,
          title: dto.title,
          status: 'DRAFT',
          defaultObservations: dto.defaultObservations,
        },
      });

      await this.createSectionsAndAnalytes(tx, version.id, dto.sections);

      return tx.resultTemplateDefinition.findUnique({
        where: { id: definition.id },
        include: DEFINITION_INCLUDE,
      });
    });
  }

  async cloneFromPlatform(labTenantId: string, platformDefinitionId: string) {
    const source = await this.prisma.resultTemplateDefinition.findUnique({
      where: { id: platformDefinitionId },
      include: DEFINITION_INCLUDE,
    });

    if (!source) throw new NotFoundException('Platform template not found');
    if (source.scope !== 'PLATFORM') {
      throw new BadRequestException('Can only clone PLATFORM templates');
    }
    if (!source.activeVersion) {
      throw new BadRequestException(
        'Platform template has no published version'
      );
    }

    const ageMin = source.ageMinWeeks;
    const ageMax = source.ageMaxWeeks;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.resultTemplateDefinition.findUnique({
        where: {
          catalogItemCode_species_ageMinWeeks_ageMaxWeeks_ownerKey: {
            catalogItemCode: source.catalogItemCode,
            species: source.species,
            ageMinWeeks: ageMin,
            ageMaxWeeks: ageMax,
            ownerKey: labTenantId,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          'A laboratory template already exists for this combination'
        );
      }

      const definition = await tx.resultTemplateDefinition.create({
        data: {
          catalogItemCode: source.catalogItemCode,
          species: source.species,
          ageMinWeeks: ageMin,
          ageMaxWeeks: ageMax,
          scope: 'LABORATORY',
          labTenantId,
          ownerKey: labTenantId,
          parentDefinitionId: source.id,
        },
      });

      const version = await tx.resultTemplateVersion.create({
        data: {
          definitionId: definition.id,
          version: 1,
          title: source.activeVersion!.title,
          status: 'DRAFT',
          defaultObservations: source.activeVersion!.defaultObservations,
        },
      });

      const sections = this.versionToSectionDtos(source.activeVersion!);
      await this.createSectionsAndAnalytes(tx, version.id, sections);

      return tx.resultTemplateDefinition.findUnique({
        where: { id: definition.id },
        include: DEFINITION_INCLUDE,
      });
    });
  }

  async createDraftVersion(definitionId: string) {
    const definition = await this.prisma.resultTemplateDefinition.findUnique({
      where: { id: definitionId },
      include: {
        activeVersion: { include: VERSION_INCLUDE },
        versions: { where: { status: 'DRAFT' }, take: 1 },
      },
    });

    if (!definition) throw new NotFoundException('Definition not found');
    if (definition.versions.length > 0) {
      throw new ConflictException('A DRAFT version already exists');
    }

    const maxVersion = await this.prisma.resultTemplateVersion.aggregate({
      where: { definitionId },
      _max: { version: true },
    });
    const nextVersion = (maxVersion._max.version ?? 0) + 1;

    return this.prisma.$transaction(async (tx) => {
      const version = await tx.resultTemplateVersion.create({
        data: {
          definitionId,
          version: nextVersion,
          title: definition.activeVersion?.title ?? 'Untitled',
          status: 'DRAFT',
          defaultObservations: definition.activeVersion?.defaultObservations,
        },
      });

      if (definition.activeVersion) {
        const sections = this.versionToSectionDtos(definition.activeVersion);
        await this.createSectionsAndAnalytes(tx, version.id, sections);
      }

      return tx.resultTemplateVersion.findUnique({
        where: { id: version.id },
        include: VERSION_INCLUDE,
      });
    });
  }

  async updateDraftVersion(versionId: string, dto: UpdateDraftVersionDto) {
    const version = await this.prisma.resultTemplateVersion.findUnique({
      where: { id: versionId },
    });

    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT versions can be edited');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.sections) {
        await tx.resultTemplateAnalyte.deleteMany({ where: { versionId } });
        await tx.resultTemplateSection.deleteMany({ where: { versionId } });
        await this.createSectionsAndAnalytes(tx, versionId, dto.sections);
      }

      return tx.resultTemplateVersion.update({
        where: { id: versionId },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.defaultObservations !== undefined && {
            defaultObservations: dto.defaultObservations,
          }),
        },
        include: VERSION_INCLUDE,
      });
    });
  }

  async publishVersion(versionId: string) {
    const version = await this.prisma.resultTemplateVersion.findUnique({
      where: { id: versionId },
      include: { definition: true },
    });

    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT versions can be published');
    }

    return this.prisma.$transaction(async (tx) => {
      if (version.definition.activeVersionId) {
        await tx.resultTemplateVersion.update({
          where: { id: version.definition.activeVersionId },
          data: { status: 'ARCHIVED' },
        });
      }

      const published = await tx.resultTemplateVersion.update({
        where: { id: versionId },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
        include: VERSION_INCLUDE,
      });

      await tx.resultTemplateDefinition.update({
        where: { id: version.definitionId },
        data: { activeVersionId: versionId },
      });

      return published;
    });
  }

  async archiveVersion(versionId: string) {
    const version = await this.prisma.resultTemplateVersion.findUnique({
      where: { id: versionId },
      include: { definition: true },
    });

    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== 'PUBLISHED') {
      throw new BadRequestException('Only PUBLISHED versions can be archived');
    }

    return this.prisma.$transaction(async (tx) => {
      const archived = await tx.resultTemplateVersion.update({
        where: { id: versionId },
        data: { status: 'ARCHIVED' },
        include: VERSION_INCLUDE,
      });

      await tx.resultTemplateDefinition.update({
        where: { id: version.definitionId },
        data: { activeVersionId: null },
      });

      return archived;
    });
  }

  async resolveTemplate(
    catalogItemCode: string,
    labTenantId: string,
    species: PatientSpecies,
    ageWeeks: number | null
  ) {
    const definitions = await this.prisma.resultTemplateDefinition.findMany({
      where: {
        catalogItemCode,
        activeVersionId: { not: null },
        OR: [{ scope: 'PLATFORM' }, { scope: 'LABORATORY', labTenantId }],
        species: { in: [species, 'ANY'] },
      },
      include: {
        activeVersion: { include: VERSION_INCLUDE },
      },
    });

    const candidates = definitions.filter((d) => {
      if (ageWeeks === null) {
        return d.ageMinWeeks === -1 && d.ageMaxWeeks === -1;
      }
      const minOk = d.ageMinWeeks === -1 || ageWeeks >= d.ageMinWeeks;
      const maxOk = d.ageMaxWeeks === -1 || ageWeeks <= d.ageMaxWeeks;
      return minOk && maxOk;
    });

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const scoreA = this.templateScore(a, species);
      const scoreB = this.templateScore(b, species);
      if (scoreB !== scoreA) return scoreB - scoreA;
      if (a.scope === 'LABORATORY' && b.scope === 'PLATFORM') return -1;
      if (a.scope === 'PLATFORM' && b.scope === 'LABORATORY') return 1;
      return 0;
    });

    return candidates[0];
  }

  private templateScore(
    d: { species: PatientSpecies; ageMinWeeks: number; ageMaxWeeks: number },
    patientSpecies: PatientSpecies
  ): number {
    const speciesScore = d.species === patientSpecies ? 2 : 0;
    const ageScore = d.ageMinWeeks !== -1 || d.ageMaxWeeks !== -1 ? 1 : 0;
    return speciesScore + ageScore;
  }

  private versionToSectionDtos(version: {
    sections: Array<{
      name: string;
      sortOrder: number;
      analytes: Array<{
        code: string;
        name: string;
        technique: string | null;
        valueType: string;
        unit: string | null;
        options: string[];
        sortOrder: number;
        isHeader: boolean;
        formula: string | null;
        referenceRange: unknown;
      }>;
    }>;
  }): TemplateSectionDto[] {
    return version.sections.map((s) => ({
      name: s.name,
      sortOrder: s.sortOrder,
      analytes: s.analytes.map((a) => ({
        code: a.code,
        name: a.name,
        technique: a.technique ?? undefined,
        valueType:
          a.valueType as TemplateSectionDto['analytes'][0]['valueType'],
        unit: a.unit ?? undefined,
        options: a.options,
        sortOrder: a.sortOrder,
        isHeader: a.isHeader,
        formula: a.formula ?? undefined,
        referenceRange: a.referenceRange as
          | { min?: number; max?: number; displayText: string }
          | undefined,
      })),
    }));
  }

  private async createSectionsAndAnalytes(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    versionId: string,
    sections: TemplateSectionDto[]
  ) {
    for (const section of sections) {
      const newSection = await (
        tx as PrismaService
      ).resultTemplateSection.create({
        data: {
          versionId,
          name: section.name,
          sortOrder: section.sortOrder,
        },
      });

      for (const analyte of section.analytes) {
        await (tx as PrismaService).resultTemplateAnalyte.create({
          data: {
            versionId,
            sectionId: newSection.id,
            code: analyte.code,
            name: analyte.name,
            technique: analyte.technique,
            valueType: analyte.valueType,
            unit: analyte.unit,
            options: analyte.options ?? [],
            sortOrder: analyte.sortOrder,
            isHeader: analyte.isHeader ?? false,
            formula: analyte.formula,
            referenceRange: analyte.referenceRange ?? undefined,
          },
        });
      }
    }
  }
}
