import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTemplateDefinitionDto,
  UpdateDraftVersionDto,
  TemplateSectionDto,
  ObservationPhraseDto,
} from './dto/template-version.dto';
import type { PatientSpecies } from '@prisma/client';
import { toStableCode } from './code-gen.util';
import {
  validateTemplateFormulas,
  type FormulaValidationError,
} from '../lab/formula.util';

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
        versions: {
          where: { status: 'DRAFT' },
          select: {
            id: true,
            version: true,
            title: true,
            status: true,
            publishedAt: true,
          },
          orderBy: { version: 'desc' },
          take: 1,
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
          include: VERSION_INCLUDE,
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

    this.validatePhrasesAndSections(dto.observationPhrases, dto.sections);

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
          observationPhrases: dto.observationPhrases
            ? (dto.observationPhrases as unknown as Record<string, unknown>[])
            : undefined,
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
          observationPhrases:
            source.activeVersion!.observationPhrases ?? undefined,
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
          observationPhrases:
            definition.activeVersion?.observationPhrases ?? undefined,
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

    if (dto.sections) {
      this.validatePhrasesAndSections(dto.observationPhrases, dto.sections);
    }

    let formulaWarnings: FormulaValidationError[] | undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
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
          ...(dto.observationPhrases !== undefined && {
            observationPhrases: dto.observationPhrases as unknown as Record<
              string,
              unknown
            >[],
          }),
        },
        include: VERSION_INCLUDE,
      });
    });

    if (dto.sections) {
      formulaWarnings = validateTemplateFormulas(
        dto.sections.map((s) => ({
          name: s.name,
          analytes: s.analytes.map((a) => ({
            code: a.code,
            name: a.name,
            formula: a.formula,
            isHeader: a.isHeader,
          })),
        }))
      );
      if (formulaWarnings.length === 0) formulaWarnings = undefined;
    }

    return { ...updated, formulaWarnings };
  }

  async publishVersion(versionId: string) {
    const version = await this.prisma.resultTemplateVersion.findUnique({
      where: { id: versionId },
      include: { definition: true, ...VERSION_INCLUDE },
    });

    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT versions can be published');
    }

    const formulaErrors = validateTemplateFormulas(
      version.sections.map((s) => ({
        name: s.name,
        analytes: s.analytes,
      }))
    );
    if (formulaErrors.length > 0) {
      throw new BadRequestException({
        message: 'Template contains invalid formulas and cannot be published',
        formulaErrors,
      });
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

  async deleteDefinition(id: string, labTenantId: string) {
    const definition = await this.prisma.resultTemplateDefinition.findUnique({
      where: { id },
    });

    if (!definition)
      throw new NotFoundException('Template definition not found');
    if (definition.scope !== 'LABORATORY') {
      throw new BadRequestException('Only lab-scope templates can be deleted');
    }
    if (definition.labTenantId !== labTenantId) {
      throw new ForbiddenException('Cannot delete templates from another lab');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.resultTemplateDefinition.update({
        where: { id },
        data: { activeVersionId: null },
      });
      await tx.resultTemplateDefinition.delete({ where: { id } });
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

  private validatePhrasesAndSections(
    phrases?: ObservationPhraseDto[],
    sections?: TemplateSectionDto[]
  ) {
    if (!phrases?.length) return;

    const phraseCodes = phrases.map((p) => p.code);
    const codeSet = new Set<string>();
    for (const code of phraseCodes) {
      if (codeSet.has(code)) {
        throw new BadRequestException(`Duplicate phrase code: '${code}'`);
      }
      codeSet.add(code);
    }

    for (const phrase of phrases) {
      if (!phrase.text.trim()) {
        throw new BadRequestException(
          `Phrase '${phrase.code}' has empty text after trimming`
        );
      }
    }

    if (sections) {
      const sectionCodes = new Set<string>();
      for (const s of sections) {
        if (s.code) {
          if (sectionCodes.has(s.code)) {
            throw new BadRequestException(
              `Duplicate section code: '${s.code}'`
            );
          }
          sectionCodes.add(s.code);
        }
      }

      for (const phrase of phrases) {
        if (phrase.sectionCode && !sectionCodes.has(phrase.sectionCode)) {
          throw new BadRequestException(
            `Phrase '${phrase.code}' references non-existent section code '${phrase.sectionCode}'`
          );
        }
      }
    }

    const normalizedTexts = new Map<string, string>();
    for (const phrase of phrases) {
      const norm = phrase.text.trim().toLowerCase();
      const existing = normalizedTexts.get(norm);
      if (existing) {
        console.warn(
          `Duplicate phrase text detected: '${phrase.code}' and '${existing}' have identical normalized text`
        );
      }
      normalizedTexts.set(norm, phrase.code);
    }
  }

  private versionToSectionDtos(version: {
    sections: Array<{
      code?: string | null;
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
    const existingCodes: string[] = version.sections
      .filter((s) => s.code)
      .map((s) => s.code!);

    return version.sections.map((s) => {
      let code = s.code ?? undefined;
      if (!code && s.name.trim()) {
        code = toStableCode(s.name, existingCodes, 'SEC') ?? undefined;
        if (code) existingCodes.push(code);
      }

      return {
        code,
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
      };
    });
  }

  private async createSectionsAndAnalytes(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    versionId: string,
    sections: TemplateSectionDto[]
  ) {
    const sectionCodes = new Set<string>();
    for (const s of sections) {
      if (s.code) {
        if (sectionCodes.has(s.code)) {
          throw new BadRequestException(
            `Duplicate section code '${s.code}' in this template version`
          );
        }
        sectionCodes.add(s.code);
      }
    }

    for (const section of sections) {
      const newSection = await (
        tx as PrismaService
      ).resultTemplateSection.create({
        data: {
          versionId,
          code: section.code ?? null,
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
