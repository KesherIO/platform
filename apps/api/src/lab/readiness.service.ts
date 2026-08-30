import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import type { PatientSpecies } from '@prisma/client';

export type ReadinessReasonCode =
  | 'CATALOG_ITEM_INACTIVE'
  | 'NO_PUBLISHED_TEMPLATE'
  | 'NO_SPECIMEN_CONFIG'
  | 'NO_PROCESSING_METHOD'
  | 'ANALYZER_REQUIRED_BUT_MISSING'
  | 'NO_REVIEWER_SIGNER';

export interface ReadinessCheck {
  code: ReadinessReasonCode;
  message: string;
  resourceId?: string;
}

export interface ReadinessResult {
  catalogItemId: string;
  catalogItemCode: string | null;
  catalogItemName: string;
  ready: boolean;
  reasons: ReadinessCheck[];
}

@Injectable()
export class ReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateVersionService: TemplateVersionService
  ) {}

  async checkReadiness(
    labTenantId: string,
    catalogItemId: string
  ): Promise<ReadinessResult> {
    const item = await this.prisma.catalogItem.findFirst({
      where: { id: catalogItemId, labTenantId },
      select: { id: true, code: true, name: true, active: true, kind: true },
    });
    if (!item) throw new NotFoundException('Catalog item not found.');

    const reasons: ReadinessCheck[] = [];

    if (!item.active) {
      reasons.push({
        code: 'CATALOG_ITEM_INACTIVE',
        message: 'Catalog item is inactive.',
        resourceId: item.id,
      });
    }

    if (item.code) {
      const template = await this.templateVersionService.resolveTemplate(
        item.code,
        labTenantId,
        'ANY' as PatientSpecies,
        null
      );
      if (!template) {
        reasons.push({
          code: 'NO_PUBLISHED_TEMPLATE',
          message: `No published result template found for code "${item.code}".`,
          resourceId: item.id,
        });
      }
    }

    const config = await this.prisma.labTestConfiguration.findFirst({
      where: { labTenantId, catalogItemId: item.id },
      include: {
        specimenRequirements: { take: 1 },
        defaultAnalyzer: { select: { id: true, isActive: true } },
      },
    });

    if (!config || config.specimenRequirements.length === 0) {
      reasons.push({
        code: 'NO_SPECIMEN_CONFIG',
        message: 'No specimen configuration found for this test.',
        resourceId: item.id,
      });
    }

    if (config && config.allowedProcessingMethods.length === 0) {
      reasons.push({
        code: 'NO_PROCESSING_METHOD',
        message: 'No processing methods configured.',
        resourceId: config.id,
      });
    }

    if (
      config &&
      config.defaultProcessingMethod === 'ANALYZER' &&
      (!config.defaultAnalyzerId ||
        (config.defaultAnalyzer && !config.defaultAnalyzer.isActive))
    ) {
      reasons.push({
        code: 'ANALYZER_REQUIRED_BUT_MISSING',
        message:
          'Default processing method is ANALYZER but no active analyzer is assigned.',
        resourceId: config.id,
      });
    }

    const reviewerCount = await this.getReviewerCount(labTenantId);
    if (reviewerCount === 0) {
      reasons.push({
        code: 'NO_REVIEWER_SIGNER',
        message: 'No reviewer/signer configured for this laboratory.',
      });
    }

    return {
      catalogItemId: item.id,
      catalogItemCode: item.code,
      catalogItemName: item.name,
      ready: reasons.length === 0,
      reasons,
    };
  }

  async checkBulkReadiness(labTenantId: string): Promise<{
    items: ReadinessResult[];
    summary: { total: number; ready: number; notReady: number };
  }> {
    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { labTenantId, kind: 'TEST' },
      select: { id: true, code: true, name: true, active: true },
      orderBy: { name: 'asc' },
    });

    const configs = await this.prisma.labTestConfiguration.findMany({
      where: { labTenantId },
      include: {
        specimenRequirements: { take: 1 },
        defaultAnalyzer: { select: { id: true, isActive: true } },
      },
    });
    const configByItem = new Map(configs.map((c) => [c.catalogItemId, c]));

    const publishedDefs = await this.prisma.resultTemplateDefinition.findMany({
      where: {
        activeVersionId: { not: null },
        OR: [{ scope: 'PLATFORM' }, { scope: 'LABORATORY', labTenantId }],
      },
      select: { catalogItemCode: true },
    });
    const publishedCodes = new Set(publishedDefs.map((d) => d.catalogItemCode));

    const reviewerCount = await this.getReviewerCount(labTenantId);

    const items: ReadinessResult[] = catalogItems.map((item) => {
      const reasons: ReadinessCheck[] = [];

      if (!item.active) {
        reasons.push({
          code: 'CATALOG_ITEM_INACTIVE',
          message: 'Catalog item is inactive.',
          resourceId: item.id,
        });
      }

      if (item.code && !publishedCodes.has(item.code)) {
        reasons.push({
          code: 'NO_PUBLISHED_TEMPLATE',
          message: `No published result template found for code "${item.code}".`,
          resourceId: item.id,
        });
      }

      const config = configByItem.get(item.id);
      if (!config || config.specimenRequirements.length === 0) {
        reasons.push({
          code: 'NO_SPECIMEN_CONFIG',
          message: 'No specimen configuration found for this test.',
          resourceId: item.id,
        });
      }

      if (config && config.allowedProcessingMethods.length === 0) {
        reasons.push({
          code: 'NO_PROCESSING_METHOD',
          message: 'No processing methods configured.',
          resourceId: config.id,
        });
      }

      if (
        config &&
        config.defaultProcessingMethod === 'ANALYZER' &&
        (!config.defaultAnalyzerId ||
          (config.defaultAnalyzer && !config.defaultAnalyzer.isActive))
      ) {
        reasons.push({
          code: 'ANALYZER_REQUIRED_BUT_MISSING',
          message:
            'Default processing method is ANALYZER but no active analyzer is assigned.',
          resourceId: config.id,
        });
      }

      if (reviewerCount === 0) {
        reasons.push({
          code: 'NO_REVIEWER_SIGNER',
          message: 'No reviewer/signer configured for this laboratory.',
        });
      }

      return {
        catalogItemId: item.id,
        catalogItemCode: item.code,
        catalogItemName: item.name,
        ready: reasons.length === 0,
        reasons,
      };
    });

    const ready = items.filter((i) => i.ready).length;
    return {
      items,
      summary: { total: items.length, ready, notReady: items.length - ready },
    };
  }

  private async getReviewerCount(labTenantId: string): Promise<number> {
    const profile = await this.prisma.laboratoryProfile.findUnique({
      where: { tenantId: labTenantId },
      select: { id: true },
    });
    if (!profile) return 0;

    return this.prisma.labSigner.count({
      where: {
        laboratoryProfileId: profile.id,
        roles: { has: 'REVIEWER' },
      },
    });
  }
}
