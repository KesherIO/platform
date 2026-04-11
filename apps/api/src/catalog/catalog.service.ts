import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogItemKindDto, ImportCatalogDto } from './dto/catalog.dto';

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
  // ---------------------------------------------------------------------------

  async findAll(includeComponents = true) {
    const items = await this.prisma.catalogItem.findMany({
      where: { active: true },
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

    await this.prisma.$transaction(
      async (tx) => {
        // Replace mode: wipe the entire global catalog before inserting.
        // CatalogItemComposition rows cascade-delete automatically.
        // CaseCatalogItem rows also cascade-delete — clinics lose their selections.
        if (body.replace) {
          await tx.catalogItem.deleteMany({});
        }

        // Pass 1 — upsert all items (tests and packages), collect id map
        const idByCode = new Map<string, string>(); // code → id
        const idByName = new Map<string, string>(); // name → id

        for (const item of body.items) {
          const upsertData = {
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
            // Upsert key: code (globally unique)
            const existing = await tx.catalogItem.findUnique({
              where: { code: item.code },
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
            // Fallback upsert key: name
            const existing = await tx.catalogItem.findFirst({
              where: { name: item.name },
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

          // Resolve component IDs from the global catalog
          const components = await tx.catalogItem.findMany({
            where: { code: { in: item.componentCodes } },
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
}
