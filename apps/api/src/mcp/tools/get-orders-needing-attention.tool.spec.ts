import { TenantRole } from '@vet-ai/shared-types';
import { registerGetOrdersNeedingAttentionTool } from './get-orders-needing-attention.tool';
import { OrderAttentionService } from '../../lab/order-attention.service';
import { McpToolContext } from '../mcp-tool-context';

const CONTEXT: McpToolContext = {
  userId: 'user-1',
  tenantId: 'lab-tenant-1',
  tenantName: 'Central Lab',
  role: TenantRole.ADMIN,
};

function registerAndGetHandler(orderAttentionService: OrderAttentionService) {
  const registerTool = jest.fn();
  const server = { registerTool } as any;
  registerGetOrdersNeedingAttentionTool(server, CONTEXT, orderAttentionService);
  const [name, config, handler] = registerTool.mock.calls[0];
  return { name, config, handler };
}

describe('get_orders_needing_attention tool', () => {
  let orderAttentionService: { getOrdersNeedingAttention: jest.Mock };

  beforeEach(() => {
    orderAttentionService = { getOrdersNeedingAttention: jest.fn() };
  });

  it('registers under the expected tool name', () => {
    const { name } = registerAndGetHandler(orderAttentionService as any);
    expect(name).toBe('get_orders_needing_attention');
  });

  it('calls the service with the session-bound tenantId, not any tool input', async () => {
    orderAttentionService.getOrdersNeedingAttention.mockResolvedValue([]);
    const { handler } = registerAndGetHandler(orderAttentionService as any);

    await handler({});

    expect(
      orderAttentionService.getOrdersNeedingAttention
    ).toHaveBeenCalledWith('lab-tenant-1');
  });

  it('returns a successful, non-error result for an empty order list', async () => {
    orderAttentionService.getOrdersNeedingAttention.mockResolvedValue([]);
    const { handler } = registerAndGetHandler(orderAttentionService as any);

    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ orders: [] });
  });

  it('maps service results through the DTO shape', async () => {
    orderAttentionService.getOrdersNeedingAttention.mockResolvedValue([
      {
        orderId: 'order-1',
        requisitionNumber: 'REQ-2026-000001',
        status: 'PROCESSING',
        priority: 'STAT',
        patientName: 'Max',
        patientSpecies: 'DOG',
        clinicName: 'Clínica Demo',
        ageMinutes: 42,
        severity: 'CRITICAL',
        attentionReasons: [
          {
            code: 'STAT_PRIORITY',
            message: 'STAT priority order is not yet completed.',
            severity: 'CRITICAL',
          },
        ],
      },
    ]);
    const { handler } = registerAndGetHandler(orderAttentionService as any);

    const result = await handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0]).toEqual(
      expect.objectContaining({ orderId: 'order-1', severity: 'CRITICAL' })
    );
  });

  it('filters to CRITICAL when minSeverity is CRITICAL', async () => {
    orderAttentionService.getOrdersNeedingAttention.mockResolvedValue([
      {
        orderId: 'o1',
        severity: 'HIGH',
        attentionReasons: [],
        requisitionNumber: '',
        status: '',
        priority: '',
        patientName: '',
        patientSpecies: '',
        clinicName: '',
        ageMinutes: 0,
      },
      {
        orderId: 'o2',
        severity: 'CRITICAL',
        attentionReasons: [],
        requisitionNumber: '',
        status: '',
        priority: '',
        patientName: '',
        patientSpecies: '',
        clinicName: '',
        ageMinutes: 0,
      },
    ]);
    const { handler } = registerAndGetHandler(orderAttentionService as any);

    const result = await handler({ minSeverity: 'CRITICAL' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0].orderId).toBe('o2');
  });

  it('rejects unknown input fields as a client error, not an internal failure', async () => {
    const { handler } = registerAndGetHandler(orderAttentionService as any);

    const result = await handler({ tenantId: 'attacker-supplied-tenant' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid input/);
    expect(
      orderAttentionService.getOrdersNeedingAttention
    ).not.toHaveBeenCalled();
  });

  it('returns a sanitized error result on an internal failure', async () => {
    orderAttentionService.getOrdersNeedingAttention.mockRejectedValue(
      new Error('db unreachable')
    );
    const { handler } = registerAndGetHandler(orderAttentionService as any);

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toMatch(/db unreachable/);
  });
});
