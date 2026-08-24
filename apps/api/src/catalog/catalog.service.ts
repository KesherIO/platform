import { readFileSync } from 'fs';
import { join } from 'path';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogItemKindDto,
  CreateCatalogItemDto,
  ImportCatalogDto,
  ListCatalogAdminDto,
  UpdateCatalogItemDto,
} from './dto/catalog.dto';

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

type RawCatalogItem = {
  id: string;
  kind: string;
  code: string | null;
  name: string;
  description: string | null;
  category: string | null;
  turnaroundHours: number | null;
  resultType: string | null;
  unit: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function mapComponent(raw: { component: RawCatalogItem }) {
  return {
    id: raw.component.id,
    kind: raw.component.kind,
    code: raw.component.code ?? undefined,
    name: raw.component.name,
    description: raw.component.description ?? undefined,
    category: raw.component.category ?? undefined,
    turnaroundHours: raw.component.turnaroundHours ?? undefined,
    resultType: raw.component.resultType ?? undefined,
    unit: raw.component.unit ?? undefined,
    active: raw.component.active,
  };
}

function mapItem(
  raw: RawCatalogItem & {
    components?: Array<{ component: RawCatalogItem }>;
  },
  includeComponents: boolean
) {
  return {
    id: raw.id,
    kind: raw.kind,
    code: raw.code ?? undefined,
    name: raw.name,
    description: raw.description ?? undefined,
    category: raw.category ?? undefined,
    turnaroundHours: raw.turnaroundHours ?? undefined,
    resultType: raw.resultType ?? undefined,
    unit: raw.unit ?? undefined,
    active: raw.active,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(includeComponents && raw.components !== undefined
      ? { components: raw.components.map(mapComponent) }
      : {}),
  };
}

// ---------------------------------------------------------------------------

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // GET /catalog
  // Clinic-facing — returns the active catalog of whichever lab the
  // requesting clinic is connected to (its default active connection).
  // ---------------------------------------------------------------------------

  async findAll(clinicTenantId: string, includeComponents = true) {
    const connection = await this.prisma.clinicLabConnection.findFirst({
      where: { clinicId: clinicTenantId, isActive: true },
      orderBy: { isDefault: 'desc' },
      select: { labId: true },
    });

    // No connected lab yet — nothing to show, not an error.
    if (!connection) return [];

    const items = await this.prisma.catalogItem.findMany({
      where: { labTenantId: connection.labId, active: true },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      include: includeComponents
        ? { components: { include: { component: true } } }
        : undefined,
    });

    return items.map((item) => mapItem(item, includeComponents));
  }

  // ---------------------------------------------------------------------------
  // POST /catalog/import
  // ---------------------------------------------------------------------------

  async import(body: ImportCatalogDto) {
    let created = 0;
    let updated = 0;
    const labTenantId = body.labTenantId;

    await this.prisma.$transaction(
      async (tx) => {
        // Replace mode: wipe this lab's catalog before inserting — other
        // labs' catalogs are untouched. CatalogItemComposition rows
        // cascade-delete automatically. CaseCatalogItem rows also
        // cascade-delete — clinics lose their selections.
        if (body.replace) {
          await tx.catalogItem.deleteMany({ where: { labTenantId } });
        }

        // Pass 1 — upsert all items (tests and packages), collect id map
        const idByCode = new Map<string, string>(); // code → id
        const idByName = new Map<string, string>(); // name → id

        for (const item of body.items) {
          const upsertData = {
            labTenantId,
            kind: item.kind,
            name: item.name,
            code: item.code ?? null,
            description: item.description ?? null,
            category: item.category ?? null,
            turnaroundHours: item.turnaroundHours ?? null,
            resultType: item.resultType ?? null,
            unit: item.unit ?? null,
          };

          let result: { id: string };

          if (item.code) {
            // Upsert key: code, unique within this lab's catalog
            const existing = await tx.catalogItem.findFirst({
              where: { code: item.code, labTenantId },
              select: { id: true },
            });

            if (existing) {
              result = await tx.catalogItem.update({
                where: { id: existing.id },
                data: upsertData,
                select: { id: true },
              });
              updated++;
            } else {
              result = await tx.catalogItem.create({
                data: upsertData,
                select: { id: true },
              });
              created++;
            }

            idByCode.set(item.code, result.id);
          } else {
            // Fallback upsert key: name, within this lab's catalog
            const existing = await tx.catalogItem.findFirst({
              where: { name: item.name, labTenantId },
              select: { id: true },
            });

            if (existing) {
              result = await tx.catalogItem.update({
                where: { id: existing.id },
                data: upsertData,
                select: { id: true },
              });
              updated++;
            } else {
              result = await tx.catalogItem.create({
                data: upsertData,
                select: { id: true },
              });
              created++;
            }

            idByName.set(item.name, result.id);
          }
        }

        // Pass 2 — wire package compositions
        for (const item of body.items) {
          if (
            item.kind !== CatalogItemKindDto.PACKAGE ||
            !item.componentCodes?.length
          ) {
            continue;
          }

          const packageId = item.code
            ? idByCode.get(item.code)
            : idByName.get(item.name);

          if (!packageId) continue;

          // Resolve component IDs from this lab's own catalog only
          const components = await tx.catalogItem.findMany({
            where: { code: { in: item.componentCodes }, labTenantId },
            select: { id: true, code: true },
          });

          const missingCodes = item.componentCodes.filter(
            (c) => !components.find((comp) => comp.code === c)
          );
          if (missingCodes.length > 0) {
            throw new BadRequestException(
              `Component codes not found for package "${
                item.name
              }": ${missingCodes.join(', ')}`
            );
          }

          // Replace compositions atomically
          await tx.catalogItemComposition.deleteMany({ where: { packageId } });
          await tx.catalogItemComposition.createMany({
            data: components.map((c) => ({ packageId, componentId: c.id })),
          });
        }
      },
      {
        timeout: 60_000, // large catalogs can have many items — 60s is safe
      }
    );

    return { created, updated };
  }

  // ---------------------------------------------------------------------------
  // Import platform catalog — lab-facing (called from lab portal by ADMIN/OWNER)
  // Reads the platform's catalog.json and upserts into the lab's own catalog.
  // ---------------------------------------------------------------------------

  async importPlatformCatalog(
    labTenantId: string
  ): Promise<{ created: number; updated: number; disabled: number; total: number }> {
    const catalogPath = join(
      process.cwd(),
      'apps/api/prisma/seeds/catalog.json'
    );
    const raw = JSON.parse(readFileSync(catalogPath, 'utf-8'));
    const result = await this.import({
      labTenantId,
      items: raw.items,
      replace: false,
    });

    // After importing, disable any existing items that share a name with a
    // platform item but have a different code — these are old duplicates the
    // lab created before adopting platform codes. Disabling them stops vets
    // from ordering with the old codes going forward.
    const platformByName = new Map<string, string>(
      (raw.items as { name: string; code?: string }[])
        .filter((i) => i.code)
        .map((i) => [i.name.toLowerCase(), i.code!])
    );

    const oldItems = await this.prisma.catalogItem.findMany({
      where: { labTenantId, active: true },
      select: { id: true, name: true, code: true },
    });

    const toDisable = oldItems.filter((item) => {
      const platformCode = platformByName.get(item.name.toLowerCase());
      return platformCode && item.code !== platformCode;
    });

    if (toDisable.length > 0) {
      await this.prisma.catalogItem.updateMany({
        where: { id: { in: toDisable.map((i) => i.id) } },
        data: { active: false },
      });
    }

    return { ...result, disabled: toDisable.length, total: raw.items.length };
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD — lab-scoped (see LabTenantGuard on the controller routes).
  // labTenantId always comes from the authenticated lab's own tenant context,
  // never from client input — that's what makes cross-lab access impossible.
  // ---------------------------------------------------------------------------

  async findAllAdmin(labTenantId: string, query: ListCatalogAdminDto) {
    const { search, kind, page = 1, pageSize = 20 } = query;

    // Counts are scoped by search but NOT by kind — the UI shows all three
    // ("All"/"Tests"/"Packages") counts side by side regardless of which
    // one is currently selected, so a search narrows all of them together.
    const searchOnlyWhere = {
      labTenantId,
      ...(search && {
        name: { contains: search, mode: 'insensitive' as const },
      }),
    };
    const where = { ...searchOnlyWhere, ...(kind && { kind }) };
    const skip = (page - 1) * pageSize;

    const [items, countAll, countTest, countPackage] = await Promise.all([
      this.prisma.catalogItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { components: { include: { component: true } } },
      }),
      this.prisma.catalogItem.count({ where: searchOnlyWhere }),
      this.prisma.catalogItem.count({
        where: { ...searchOnlyWhere, kind: 'TEST' },
      }),
      this.prisma.catalogItem.count({
        where: { ...searchOnlyWhere, kind: 'PACKAGE' },
      }),
    ]);

    const total =
      kind === 'TEST'
        ? countTest
        : kind === 'PACKAGE'
        ? countPackage
        : countAll;

    return {
      // includeComponents:true — the admin UI needs a PACKAGE's existing
      // component ids to pre-fill the edit form; without this an edit would
      // silently wipe composition since the client would submit an empty list.
      data: items.map((item) => mapItem(item, true)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      counts: { all: countAll, TEST: countTest, PACKAGE: countPackage },
    };
  }

  async createItem(labTenantId: string, dto: CreateCatalogItemDto) {
    if (dto.code) {
      const existing = await this.prisma.catalogItem.findFirst({
        where: { code: dto.code, labTenantId },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(
          `A catalog item with code "${dto.code}" already exists.`
        );
      }
    }

    const componentIds = await this.resolveOwnComponentIds(
      labTenantId,
      dto.componentIds
    );

    const item = await this.prisma.catalogItem.create({
      data: {
        labTenantId,
        kind: dto.kind,
        name: dto.name,
        code: dto.code ?? null,
        category: dto.category ?? null,
        turnaroundHours: dto.turnaroundHours ?? null,
        resultType: dto.resultType ?? null,
        unit: dto.unit ?? null,
        description: dto.description ?? null,
      },
    });

    if (componentIds.length > 0) {
      await this.prisma.catalogItemComposition.createMany({
        data: componentIds.map((componentId) => ({
          packageId: item.id,
          componentId,
        })),
      });
    }

    return mapItem(item, false);
  }

  async updateItem(labTenantId: string, id: string, dto: UpdateCatalogItemDto) {
    const existing = await this.prisma.catalogItem.findUnique({
      where: { id },
      select: { labTenantId: true, code: true },
    });
    if (!existing || existing.labTenantId !== labTenantId) {
      throw new NotFoundException('Catalog item not found.');
    }

    const isCodeChange = dto.code !== undefined && dto.code !== existing.code;

    if (isCodeChange) {
      // Code is what external integrations, AI suggestions, and imports key
      // off of — once a case/order has referenced this item, changing it
      // would silently break that history. Block it rather than allow it.
      const [caseUsage, orderUsage] = await Promise.all([
        this.prisma.caseCatalogItem.count({ where: { catalogItemId: id } }),
        this.prisma.orderedTest.count({ where: { catalogItemId: id } }),
      ]);
      if (caseUsage > 0 || orderUsage > 0) {
        throw new BadRequestException(
          'This code cannot be changed because the item has already been used on a case or order.'
        );
      }

      const codeConflict = await this.prisma.catalogItem.findFirst({
        where: { code: dto.code, labTenantId, id: { not: id } },
        select: { id: true },
      });
      if (codeConflict) {
        throw new ConflictException(
          `A catalog item with code "${dto.code}" already exists.`
        );
      }
    }

    // Resolve/validate componentIds BEFORE mutating anything — otherwise a
    // rejected package composition (wrong lab, non-TEST, self-reference)
    // would leave the scalar fields already saved as a partial write.
    const resolvedIds =
      dto.componentIds !== undefined
        ? await this.resolveOwnComponentIds(labTenantId, dto.componentIds, id)
        : undefined;

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.turnaroundHours !== undefined)
      updateData.turnaroundHours = dto.turnaroundHours;
    if (dto.resultType !== undefined) updateData.resultType = dto.resultType;
    if (dto.unit !== undefined) updateData.unit = dto.unit;
    if (dto.description !== undefined) updateData.description = dto.description;

    const item = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.catalogItem.update({
        where: { id },
        data: updateData,
      });

      if (resolvedIds !== undefined) {
        await tx.catalogItemComposition.deleteMany({
          where: { packageId: id },
        });
        if (resolvedIds.length > 0) {
          await tx.catalogItemComposition.createMany({
            data: resolvedIds.map((componentId) => ({
              packageId: id,
              componentId,
            })),
          });
        }
      }

      return updated;
    });

    return mapItem(item, false);
  }

  async setActive(labTenantId: string, id: string, active: boolean) {
    const existing = await this.prisma.catalogItem.findUnique({
      where: { id },
      select: { labTenantId: true },
    });
    if (!existing || existing.labTenantId !== labTenantId) {
      throw new NotFoundException('Catalog item not found.');
    }

    const item = await this.prisma.catalogItem.update({
      where: { id },
      data: { active },
    });

    return mapItem(item, false);
  }

  // Verifies every componentId belongs to this lab's own catalog, is a TEST
  // (never a PACKAGE — no nested packages), and isn't the package itself.
  private async resolveOwnComponentIds(
    labTenantId: string,
    componentIds: string[] | undefined,
    selfId?: string
  ): Promise<string[]> {
    if (!componentIds?.length) return [];

    if (selfId && componentIds.includes(selfId)) {
      throw new BadRequestException('A package cannot contain itself.');
    }

    const owned = await this.prisma.catalogItem.findMany({
      where: { id: { in: componentIds }, labTenantId },
      select: { id: true, kind: true },
    });

    if (owned.length !== componentIds.length) {
      throw new BadRequestException(
        "One or more component items were not found in this lab's catalog."
      );
    }

    const nonTest = owned.filter((c) => c.kind !== 'TEST');
    if (nonTest.length > 0) {
      throw new BadRequestException('Packages can only contain TEST items.');
    }

    return owned.map((c) => c.id);
  }
}
