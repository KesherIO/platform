jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  withScope: jest.fn((cb) => cb({ setTag: jest.fn(), setUser: jest.fn(), setExtra: jest.fn() })),
}));

import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let mockDbIndicator: { isHealthy: jest.Mock };

  beforeEach(() => {
    mockDbIndicator = { isHealthy: jest.fn() };
    controller = new HealthController(mockDbIndicator as never);
  });

  it('liveness returns 200 with status ok', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('readiness returns ok when database is up', async () => {
    mockDbIndicator.isHealthy.mockResolvedValue({ database: { status: 'up' } });

    const result = await controller.ready();
    expect(result).toEqual({
      status: 'ok',
      details: { database: { status: 'up' } },
    });
  });

  it('readiness throws 503 when database is down', async () => {
    mockDbIndicator.isHealthy.mockResolvedValue({ database: { status: 'down' } });

    await expect(controller.ready()).rejects.toThrow(ServiceUnavailableException);
  });

  it('health responses do not contain sensitive information', () => {
    const response = controller.live();
    const json = JSON.stringify(response);
    expect(json).not.toContain('DATABASE_URL');
    expect(json).not.toContain('password');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('supabase');
  });
});
