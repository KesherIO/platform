import type { Prisma } from '@prisma/client';
import type { OrderedItem } from '@vet-ai/shared-types';

/** Where a test on an order came from: a direct line or a package line. */
export interface ExpandedTestSource {
  originCatalogItemId: string;
  sourceType: 'DIRECT' | 'PACKAGE';
  originalOrderItemKey: string;
  originalOrderItemIndex: number;
  quantity: number;
  originCode: string | null;
  originName: string;
}

export interface ExpandedTest {
  catalogItemId: string;
  catalogItemCode: string | null;
  catalogItemName: string;
  sources: ExpandedTestSource[];
}

/**
 * Expands order lines into the tests to run: PACKAGE lines become their
 * component TESTs (CatalogItemComposition), and a test reached more than once
 * (in several packages, or directly and via a package) appears once with one
 * source per origin. `startIndex` numbers the lines when they continue an
 * order that already has lines.
 */
export async function expandOrderedItems(
  db: Pick<Prisma.TransactionClient, 'catalogItemComposition'>,
  items: OrderedItem[],
  startIndex = 0
): Promise<ExpandedTest[]> {
  const packageIds = items
    .filter((i) => i.kind === 'PACKAGE')
    .map((i) => i.catalogItemId);

  const compositions =
    packageIds.length > 0
      ? await db.catalogItemComposition.findMany({
          where: { packageId: { in: packageIds } },
          include: {
            component: { select: { id: true, code: true, name: true } },
          },
        })
      : [];

  const componentsByPackage = new Map<
    string,
    Array<{ id: string; code: string | null; name: string }>
  >();
  for (const comp of compositions) {
    const list = componentsByPackage.get(comp.packageId) ?? [];
    list.push(comp.component);
    componentsByPackage.set(comp.packageId, list);
  }

  const testMap = new Map<string, ExpandedTest>();
  const addSource = (
    catalogItemId: string,
    catalogItemCode: string | null,
    catalogItemName: string,
    source: ExpandedTestSource
  ) => {
    const existing = testMap.get(catalogItemId);
    if (existing) {
      existing.sources.push(source);
    } else {
      testMap.set(catalogItemId, {
        catalogItemId,
        catalogItemCode,
        catalogItemName,
        sources: [source],
      });
    }
  };

  items.forEach((item, i) => {
    const index = startIndex + i;
    const origin = {
      originCatalogItemId: item.catalogItemId,
      originalOrderItemKey: `line-${index}`,
      originalOrderItemIndex: index,
      quantity: 1,
      originCode: item.code ?? null,
      originName: item.name,
    };
    if (item.kind === 'PACKAGE') {
      for (const comp of componentsByPackage.get(item.catalogItemId) ?? []) {
        addSource(comp.id, comp.code, comp.name, {
          ...origin,
          sourceType: 'PACKAGE',
        });
      }
    } else {
      addSource(item.catalogItemId, item.code, item.name, {
        ...origin,
        sourceType: 'DIRECT',
      });
    }
  });

  return Array.from(testMap.values());
}
