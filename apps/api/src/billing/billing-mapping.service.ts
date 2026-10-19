import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  suggestBillingMappings,
  type MappingRowInput,
} from './billing-mapping.util';
import { normalizeBillingCode } from './billing-code.util';
import type { MappingAssignmentDto } from './dto/billing.dto';

/**
 * Pairs the lab's own billing codes with catalog items it already has.
 * Never creates or edits an item beyond its billingCode: ids, internal codes,
 * names, packages' components, templates and past orders stay as they are.
 * Everything is scoped to labTenantId from the authenticated session.
 */
@Injectable()
export class BillingMappingService {
  private readonly logger = new Logger(BillingMappingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Read-only: ranks this lab's items for each row; nothing is saved. */
  async suggest(labTenantId: string, rows: MappingRowInput[]) {
    const items = await this.prisma.catalogItem.findMany({
      where: { labTenantId },
      select: {
        id: true,
        kind: true,
        code: true,
        name: true,
        billingCode: true,
      },
    });
    return {
      suggestions: suggestBillingMappings(rows, items),
    };
  }

  /** All-or-nothing: either every pair is saved or none is. */
  async apply(
    labTenantId: string,
    assignments: MappingAssignmentDto[],
    replaceExisting: boolean,
    userId: string
  ) {
    const normalized = assignments.map((a) => {
      const billingCode = normalizeBillingCode(a.billingCode);
      if (!billingCode) {
        throw new BadRequestException('A billing code cannot be empty.');
      }
      return { catalogItemId: a.catalogItemId, billingCode };
    });

    const ids = normalized.map((a) => a.catalogItemId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'A catalog item appears more than once in the request.'
      );
    }
    const lowered = normalized.map((a) => a.billingCode.toLowerCase());
    if (new Set(lowered).size !== lowered.length) {
      throw new BadRequestException(
        'The same billing code is assigned to more than one catalog item.'
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Only this lab's items count: another lab's id is "not found"
      const own = await tx.catalogItem.findMany({
        where: { labTenantId },
        select: { id: true, name: true, billingCode: true },
      });
      const byId = new Map(own.map((i) => [i.id, i]));
      const unknown = ids.filter((id) => !byId.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException(
          "One or more catalog items were not found in this lab's catalog."
        );
      }

      const takenBy = new Map(
        own
          .filter((i) => i.billingCode)
          .map((i) => [(i.billingCode as string).toLowerCase(), i])
      );
      const clashes = normalized.flatMap((a) => {
        const holder = takenBy.get(a.billingCode.toLowerCase());
        return holder && holder.id !== a.catalogItemId
          ? [`"${a.billingCode}" is already used by "${holder.name}"`]
          : [];
      });
      if (clashes.length > 0) {
        throw new ConflictException({
          code: 'BILLING_CODE_IN_USE',
          message: clashes.join('; '),
        });
      }

      const replacing = normalized.filter((a) => {
        const current = byId.get(a.catalogItemId)?.billingCode;
        return current && current !== a.billingCode;
      });
      if (replacing.length > 0 && !replaceExisting) {
        throw new ConflictException({
          code: 'BILLING_CODE_REPLACE_NOT_CONFIRMED',
          message:
            'Some items already have a different billing code. Confirm to replace them.',
          items: replacing.map((a) => ({
            catalogItemId: a.catalogItemId,
            name: byId.get(a.catalogItemId)?.name,
            currentBillingCode: byId.get(a.catalogItemId)?.billingCode,
            newBillingCode: a.billingCode,
          })),
        });
      }

      // Swapping codes between two items in one request would trip the unique
      // index mid-way; clear the ones being replaced first.
      if (replacing.length > 0) {
        await tx.catalogItem.updateMany({
          where: {
            labTenantId,
            id: { in: replacing.map((a) => a.catalogItemId) },
          },
          data: { billingCode: null },
        });
      }
      let changed = 0;
      for (const a of normalized) {
        if (byId.get(a.catalogItemId)?.billingCode === a.billingCode) continue;
        await tx.catalogItem.update({
          where: { id: a.catalogItemId },
          data: { billingCode: a.billingCode },
          select: { id: true },
        });
        changed++;
      }

      this.logger.log(
        `Billing codes mapped lab=${labTenantId} user=${userId} ` +
          `changed=${changed} replaced=${replacing.length}`
      );
      return { updated: changed, unchanged: normalized.length - changed };
    });
  }

  // -------------------------------------------------------------------------
  // Order lines whose catalog item was deleted
  // -------------------------------------------------------------------------

  /**
   * Assigns a reviewed billing code to every line of this lab's orders that
   * still points at a catalog item which no longer exists. The orders are not
   * modified, no catalog item is recreated and the internal code is never
   * used: the code applies only to future exports (generated files keep the
   * rows they were generated with).
   */
  async assignDeletedItemCode(
    labTenantId: string,
    catalogItemId: string,
    rawCode: string,
    user: { id: string; name: string }
  ) {
    const billingCode = normalizeBillingCode(rawCode);
    if (!billingCode) {
      throw new BadRequestException('A billing code cannot be empty.');
    }

    // Only items that really are gone: a live item gets its code in the catalog
    const live = await this.prisma.catalogItem.findUnique({
      where: { id: catalogItemId },
      select: { labTenantId: true },
    });
    if (live) {
      if (live.labTenantId === labTenantId) {
        throw new ConflictException({
          code: 'ITEM_STILL_IN_CATALOG',
          message:
            'This item still exists in your catalog: set its billing code there.',
        });
      }
      // Another lab's item: indistinguishable from "no such line"
      throw new NotFoundException(
        'No order of this laboratory has a line for this item.'
      );
    }

    // What the lab is about to code, from its own orders (the review snapshot)
    const lines = await this.prisma.$queryRaw<
      Array<{
        name: string;
        code: string | null;
        lines: number;
        orders: number;
      }>
    >`
      SELECT elem->>'name' AS name, elem->>'code' AS code,
             COUNT(*)::int AS lines, COUNT(DISTINCT o.id)::int AS orders
      FROM orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o."orderedItems") = 'array'
             THEN o."orderedItems" ELSE '[]'::jsonb END
      ) AS elem
      WHERE o."labTenantId" = ${labTenantId}
        AND elem->>'catalogItemId' = ${catalogItemId}
      GROUP BY 1, 2
      ORDER BY lines DESC`;
    if (lines.length === 0) {
      throw new NotFoundException(
        'No order of this laboratory has a line for this item.'
      );
    }

    const snapshot = lines[0];
    await this.prisma.billingDeletedItemCode.upsert({
      where: {
        labTenantId_catalogItemId: { labTenantId, catalogItemId },
      },
      create: {
        labTenantId,
        catalogItemId,
        billingCode,
        itemName: snapshot.name ?? '',
        internalCode: snapshot.code,
        assignedByUserId: user.id,
        assignedByName: user.name,
      },
      update: {
        billingCode,
        assignedByUserId: user.id,
        assignedByName: user.name,
      },
    });

    this.logger.log(
      `Billing code for deleted item lab=${labTenantId} user=${user.id} ` +
        `item=${catalogItemId} lines=${lines.reduce((n, l) => n + l.lines, 0)}`
    );
    return {
      catalogItemId,
      billingCode,
      itemName: snapshot.name,
      lineCount: lines.reduce((n, l) => n + l.lines, 0),
      orderCount: lines.reduce((n, l) => n + l.orders, 0),
    };
  }

  async clearDeletedItemCode(labTenantId: string, catalogItemId: string) {
    const { count } = await this.prisma.billingDeletedItemCode.deleteMany({
      where: { labTenantId, catalogItemId },
    });
    if (count === 0) {
      throw new NotFoundException('No billing code is set for this item.');
    }
    return { removed: count };
  }
}
