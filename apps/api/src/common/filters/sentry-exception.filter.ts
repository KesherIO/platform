import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import type { HttpServer } from '@nestjs/common';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import * as Sentry from '@sentry/nestjs';
import { Request } from 'express';

@Catch()
export class SentryExceptionFilter extends SentryGlobalFilter {
  constructor(applicationRef?: HttpServer) {
    super(applicationRef);
  }

  override catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() === 'http') {
      const request = host.switchToHttp().getRequest<Request>();
      const req = request as unknown as Record<string, unknown>;
      const user = req['user'] as { id?: string; email?: string } | undefined;
      const tenant = req['tenant'] as
        | { tenantId?: string; role?: string }
        | undefined;
      const requestId = req['requestId'] as string | undefined;

      Sentry.withScope((scope) => {
        if (requestId) {
          scope.setTag('requestId', requestId);
        }
        if (user?.id) {
          scope.setUser({ id: user.id });
        }
        if (tenant?.tenantId) {
          scope.setTag('tenantId', tenant.tenantId);
        }
        if (tenant?.role) {
          scope.setTag('role', tenant.role);
        }

        const statusCode =
          exception instanceof HttpException ? exception.getStatus() : 500;
        scope.setExtra('statusCode', statusCode);
      });
    }

    return super.catch(exception, host);
  }
}
