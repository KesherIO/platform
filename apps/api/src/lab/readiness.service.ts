import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ReadinessReasonCode = 'CATALOG_ITEM_INACTIVE';

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
  constructor(private readonly prisma: PrismaService) {}

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

    const items: ReadinessResult[] = catalogItems.map((item) => {
      const reasons: ReadinessCheck[] = [];

      if (!item.active) {
        reasons.push({
          code: 'CATALOG_ITEM_INACTIVE',
          message: 'Catalog item is inactive.',
          resourceId: item.id,
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
}
