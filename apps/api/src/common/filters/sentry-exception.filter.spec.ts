import { ArgumentsHost, HttpException, HttpServer } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { SentryExceptionFilter } from './sentry-exception.filter';

jest.mock('@sentry/nestjs', () => ({
  withScope: jest.fn((cb) => cb({ setTag: jest.fn(), setUser: jest.fn(), setExtra: jest.fn() })),
  captureException: jest.fn(),
}));

jest.mock('@sentry/nestjs/setup', () => ({
  SentryGlobalFilter: class {
    catch(_exception: unknown, _host: ArgumentsHost) {
      // no-op for test
    }
  },
}));

describe('SentryExceptionFilter', () => {
  let filter: SentryExceptionFilter;
  let mockScope: { setTag: jest.Mock; setUser: jest.Mock; setExtra: jest.Mock };

  function createHost(overrides: {
    user?: Record<string, unknown>;
    tenant?: Record<string, unknown>;
    requestId?: string;
  } = {}): ArgumentsHost {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          user: overrides.user,
          tenant: overrides.tenant,
          requestId: overrides.requestId || 'req-123',
        }),
        getResponse: () => ({ statusCode: 500 }),
      }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    mockScope = { setTag: jest.fn(), setUser: jest.fn(), setExtra: jest.fn() };
    (Sentry.withScope as jest.Mock).mockImplementation((cb) => cb(mockScope));
    filter = new SentryExceptionFilter(undefined as unknown as HttpServer);
  });

  it('attaches requestId, userId and tenantId to Sentry scope', () => {
    const host = createHost({
      user: { id: 'user-1' },
      tenant: { tenantId: 'tenant-1', role: 'ADMIN' },
      requestId: 'req-abc',
    });

    filter.catch(new Error('test'), host);

    expect(mockScope.setTag).toHaveBeenCalledWith('requestId', 'req-abc');
    expect(mockScope.setUser).toHaveBeenCalledWith({ id: 'user-1' });
    expect(mockScope.setTag).toHaveBeenCalledWith('tenantId', 'tenant-1');
    expect(mockScope.setTag).toHaveBeenCalledWith('role', 'ADMIN');
  });

  it('sets statusCode extra for HttpException', () => {
    const host = createHost();
    const exception = new HttpException('Not Found', 404);

    filter.catch(exception, host);

    expect(mockScope.setExtra).toHaveBeenCalledWith('statusCode', 404);
  });

  it('handles missing user and tenant gracefully', () => {
    const host = createHost({ user: undefined, tenant: undefined });

    expect(() => filter.catch(new Error('test'), host)).not.toThrow();
    expect(mockScope.setUser).not.toHaveBeenCalled();
  });
});
