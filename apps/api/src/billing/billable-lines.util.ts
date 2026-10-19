import type { OrderedItem } from '@vet-ai/shared-types';

/**
 * What a billing file charges for, derived from the order as the clinic placed
 * it — NOT from the expanded tests:
 *
 *  - Order.orderedItems is the purchased lines. A PACKAGE line is one charge;
 *    its component tests (OrderedTest rows) are how it is performed, never
 *    extra charges. Tests added later (add-tests) are appended as new lines.
 *  - Quantity is not modelled on an order line (one catalog selection = one
 *    line), so every line is quantity 1.
 *  - Cancellation exists only on the order and on OrderedTest. A line is
 *    cancelled when the order is, or when every test performed for it is
 *    (OrderedTestSource.originalOrderItemKey links a test back to its line).
 *    A package with only some components cancelled is still billed.
 *  - Results, amendments, re-releases and replaced specimens never touch
 *    orderedItems or add OrderedTests, so they cannot create a charge.
 */

export interface BillableOrderInput {
  id: string;
  requisitionNumber: string;
  status: string;
  createdAt: Date;
  clinicName: string;
  patientName: string;
  orderedItems: OrderedItem[];
  orderedTests: Array<{
    catalogItemId: string | null;
    status: string;
    sources: Array<{ originalOrderItemKey: string }>;
  }>;
}

export interface BillableLine {
  orderId: string;
  requisitionNumber: string;
  /** "line-N": index in Order.orderedItems (append-only, so stable) */
  lineKey: string;
  orderCreatedAt: Date;
  clinicName: string;
  patientName: string;
  catalogItemId: string;
  kind: 'TEST' | 'PACKAGE';
  internalCode: string | null;
  name: string;
  quantity: number;
}

export type ExclusionReason = 'ORDER_CANCELLED' | 'ITEM_CANCELLED';

export interface ExcludedLine {
  orderId: string;
  lineKey: string;
  reason: ExclusionReason;
}

export function deriveBillableLines(orders: BillableOrderInput[]): {
  lines: BillableLine[];
  excluded: ExcludedLine[];
} {
  const lines: BillableLine[] = [];
  const excluded: ExcludedLine[] = [];

  for (const order of orders) {
    const items = Array.isArray(order.orderedItems) ? order.orderedItems : [];
    const hasAnySource = order.orderedTests.some((t) => t.sources.length > 0);

    items.forEach((item, index) => {
      const lineKey = `line-${index}`;

      if (order.status === 'CANCELLED') {
        excluded.push({
          orderId: order.id,
          lineKey,
          reason: 'ORDER_CANCELLED',
        });
        return;
      }

      let linked = order.orderedTests.filter((t) =>
        t.sources.some((s) => s.originalOrderItemKey === lineKey)
      );
      // Orders whose tests carry no source rows at all: a standalone test can
      // still be matched by catalog item (a package cannot — left billable).
      if (linked.length === 0 && !hasAnySource && item.kind === 'TEST') {
        linked = order.orderedTests.filter(
          (t) => t.catalogItemId === item.catalogItemId
        );
      }

      // No tests yet (not accessioned) or none linked: nothing is cancelled
      if (linked.length > 0 && linked.every((t) => t.status === 'CANCELLED')) {
        excluded.push({ orderId: order.id, lineKey, reason: 'ITEM_CANCELLED' });
        return;
      }

      lines.push({
        orderId: order.id,
        requisitionNumber: order.requisitionNumber,
        lineKey,
        orderCreatedAt: order.createdAt,
        clinicName: order.clinicName,
        patientName: order.patientName,
        catalogItemId: item.catalogItemId,
        kind: item.kind,
        internalCode: item.code ?? null,
        name: item.name,
        quantity: 1,
      });
    });
  }

  return { lines, excluded };
}
