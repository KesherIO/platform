import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'crypto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && UUID_RE.test(incoming)
        ? incoming
        : randomUUID();

    (req as Record<string, unknown>)['requestId'] = requestId;
    res.setHeader('x-request-id', requestId);

    const scope = Sentry.getIsolationScope();
    scope.setTag('requestId', requestId);

    next();
  }
}
