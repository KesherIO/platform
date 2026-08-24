import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { PatientSpecies, AnalyteValueType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlatformSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    if (process.env['NODE_ENV'] === 'test') return;

    const existing = await this.prisma.resultTemplateDefinition.count({
      where: { scope: 'PLATFORM' },
    });

    if (existing > 0) {
      this.logger.log(`Platform templates already seeded (${existing} found).`);
      return;
    }

    this.logger.log('No platform templates found — seeding now...');

    const templatesDir = join(process.cwd(), 'apps/api/prisma/seeds/templates');

    let files: string[];
    try {
      files = readdirSync(templatesDir).filter((f) => f.endsWith('.json'));
    } catch {
      this.logger.warn(
        `Template seed directory not found at ${templatesDir}. Skipping.`
      );
      return;
    }

    let created = 0;

    for (const file of files) {
      let raw: {
        catalogItemCode: string;
        species: string;
        title: string;
        defaultObservations?: string | null;
        ageMinWeeks?: number;
        ageMaxWeeks?: number;
        sections?: Array<{
          name: string;
          sortOrder: number;
          analytes?: Array<{
            code: string;
            name: string;
            technique?: string | null;
            valueType: AnalyteValueType;
            unit?: string | null;
            options?: string[];
            sortOrder: number;
            isHeader?: boolean;
            formula?: string | null;
            referenceRange?: unknown;
          }>;
        }>;
      };
      try {
        raw = JSON.parse(readFileSync(join(templatesDir, file), 'utf-8'));
      } catch {
        this.logger.warn(`Skipping ${file} — invalid or empty JSON`);
        continue;
      }

      const {
        catalogItemCode,
        species,
        title,
        defaultObservations,
        sections = [],
      } = raw;
      const ageMin = raw.ageMinWeeks ?? -1;
      const ageMax = raw.ageMaxWeeks ?? -1;

      const alreadyExists =
        await this.prisma.resultTemplateDefinition.findUnique({
          where: {
            catalogItemCode_species_ageMinWeeks_ageMaxWeeks_ownerKey: {
              catalogItemCode,
              species: species as PatientSpecies,
              ageMinWeeks: ageMin,
              ageMaxWeeks: ageMax,
              ownerKey: 'platform',
            },
          },
          select: { id: true },
        });

      if (alreadyExists) continue;

      await this.prisma.$transaction(async (tx) => {
        const definition = await tx.resultTemplateDefinition.create({
          data: {
            catalogItemCode,
            species: species as PatientSpecies,
            ageMinWeeks: ageMin,
            ageMaxWeeks: ageMax,
            scope: 'PLATFORM',
            ownerKey: 'platform',
          },
        });

        const version = await tx.resultTemplateVersion.create({
          data: {
            definitionId: definition.id,
            version: 1,
            title,
            status: 'PUBLISHED',
            defaultObservations: defaultObservations ?? null,
            publishedAt: new Date(),
          },
        });

        for (const section of sections) {
          const newSection = await tx.resultTemplateSection.create({
            data: {
              versionId: version.id,
              name: section.name,
              sortOrder: section.sortOrder,
            },
          });

          for (const analyte of section.analytes ?? []) {
            await tx.resultTemplateAnalyte.create({
              data: {
                versionId: version.id,
                sectionId: newSection.id,
                code: analyte.code,
                name: analyte.name,
                technique: analyte.technique ?? null,
                valueType: analyte.valueType,
                unit: analyte.unit ?? null,
                options: analyte.options ?? [],
                sortOrder: analyte.sortOrder,
                isHeader: analyte.isHeader ?? false,
                formula: analyte.formula ?? null,
                referenceRange: analyte.referenceRange ?? undefined,
              },
            });
          }
        }

        await tx.resultTemplateDefinition.update({
          where: { id: definition.id },
          data: { activeVersionId: version.id },
        });
      });

      created++;
    }

    this.logger.log(
      `Platform templates seeded: ${created} created from ${files.length} files.`
    );
  }
}
