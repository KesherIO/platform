import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let stdoutSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  function createContext(
    overrides: {
      method?: string;
      url?: string;
      originalUrl?: string;
      user?: Record<string, unknown>;
      tenant?: Record<string, unknown>;
      requestId?: string;
      statusCode?: number;
    } = {},
  ): { context: ExecutionContext; next: CallHandler } {
    const req = {
      method: overrides.method || 'GET',
      url: overrides.url || '/api/orders',
      originalUrl: overrides.originalUrl || overrides.url || '/api/orders',
      user: overrides.user,
      tenant: overrides.tenant,
      requestId: overrides.requestId || 'test-uuid',
    };
    const res = { statusCode: overrides.statusCode || 200 };

    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;

    const next = { handle: () => of(undefined) } as CallHandler;
    return { context, next };
  }

  it('emits structured JSON to stdout', (done) => {
    const { context, next } = createContext({
      user: { id: 'user-1' },
      tenant: { tenantId: 'tenant-1', role: 'VET' },
    });

    interceptor.intercept(context, next).subscribe(() => {
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('info');
      expect(parsed.method).toBe('GET');
      expect(parsed.route).toBe('/api/orders');
      expect(parsed.statusCode).toBe(200);
      expect(parsed.userId).toBe('user-1');
      expect(parsed.tenantId).toBe('tenant-1');
      expect(parsed.role).toBe('VET');
      expect(parsed.requestId).toBe('test-uuid');
      expect(parsed.durationMs).toEqual(expect.any(Number));
      done();
    });
  });

  it('skips health check paths when status is 2xx', (done) => {
    const { context, next } = createContext({
      url: '/api/health/live',
      originalUrl: '/api/health/live',
    });

    interceptor.intercept(context, next).subscribe(() => {
      expect(stdoutSpy).not.toHaveBeenCalled();
      done();
    });
  });

  it('logs health check paths when status is 5xx', (done) => {
    const { context, next } = createContext({
      url: '/api/health/ready',
      originalUrl: '/api/health/ready',
      statusCode: 503,
    });

    interceptor.intercept(context, next).subscribe(() => {
      expect(stdoutSpy).toHaveBeenCalled();
      const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
      expect(parsed.level).toBe('error');
      done();
    });
  });

  it('does not include request bodies in the log', (done) => {
    const { context, next } = createContext();

    interceptor.intercept(context, next).subscribe(() => {
      if (stdoutSpy.mock.calls.length > 0) {
        const output = stdoutSpy.mock.calls[0][0] as string;
        expect(output).not.toContain('body');
        expect(output).not.toContain('data');
      }
      done();
    });
  });
});
