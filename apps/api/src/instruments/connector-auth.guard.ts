import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ConnectorContext, ConnectorCredentialService } from './connector-credential.service';

export type ConnectorRequest = Request & { connector: ConnectorContext };

/**
 * Authenticates a connector by its revocable per-analyzer token
 * (`Authorization: Bearer kvc_…`). Pair with @Public() so the Supabase JWT
 * guard steps aside: connectors are machines and have no user session.
 * Binds the request to exactly one lab + analyzer; handlers never take the
 * lab from the body or a header.
 */
@Injectable()
export class ConnectorAuthGuard implements CanActivate {
  constructor(private readonly credentials: ConnectorCredentialService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ConnectorRequest>();
    const header = request.headers.authorization ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
    const connector = await this.credentials.authenticate(token, request.ip);
    if (!connector) throw new UnauthorizedException('Invalid or revoked connector credential.');
    request.connector = connector;
    return true;
  }
}
