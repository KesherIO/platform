import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';

const SILENT_PATHS = new Set(['/api/health/live', '/api/health/ready']);

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const start = Date.now();
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap({
        next: () => this.log(req, res, start),
        error: () => this.log(req, res, start),
      })
    );
  }

  private log(req: Request, res: Response, start: number) {
    const statusCode = res.statusCode;
    const path = req.originalUrl || req.url;

    if (statusCode < 400 && SILENT_PATHS.has(path)) return;

    const r = req as unknown as Record<string, unknown>;
    const user = r['user'] as { id?: string } | undefined;
    const tenant = r['tenant'] as
      | { tenantId?: string; role?: string }
      | undefined;

    const entry = {
      level: statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info',
      message: `HTTP ${req.method} ${path} ${statusCode} ${
        Date.now() - start
      }ms`,
      requestId: r['requestId'] || undefined,
      method: req.method,
      route: path,
      statusCode,
      durationMs: Date.now() - start,
      userId: user?.id || undefined,
      tenantId: tenant?.tenantId || undefined,
      role: tenant?.role || undefined,
      environment: process.env['NODE_ENV'] || 'development',
      timestamp: new Date().toISOString(),
    };

    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}
