import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Guards endpoints that are intended for internal Biomet use only.
 * Requires the request to include the `x-internal-api-key` header matching
 * the INTERNAL_API_KEY environment variable.
 *
 * Apply with @UseGuards(InternalApiKeyGuard) alongside @Public() so that
 * the JWT guard is bypassed but the internal key check still runs.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-internal-api-key'];
    const expected = this.config.get<string>('INTERNAL_API_KEY');

    if (!expected || provided !== expected) {
      throw new ForbiddenException('Invalid or missing internal API key');
    }

    return true;
  }
}
