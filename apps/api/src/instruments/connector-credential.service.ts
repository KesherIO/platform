import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateToken, parseToken, tokenMatches } from './connector-token.util';

export interface ConnectorContext {
  credentialId: string;
  credentialName: string;
  labTenantId: string;
  analyzerId: string;
  analyzerName: string;
}

/** lastSeenAt is written at most this often per credential. */
const TOUCH_INTERVAL_MS = 60_000;

@Injectable()
export class ConnectorCredentialService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates a credential for ONE lab's ONE analyzer. The token is returned here and never again. */
  async create(labTenantId: string, analyzerId: string, name: string, createdById: string) {
    const analyzer = await this.prisma.analyzer.findFirst({
      where: { id: analyzerId, labTenantId },
      select: { id: true, isActive: true },
    });
    if (!analyzer) throw new NotFoundException('Analyzer not found in this laboratory.');
    if (!analyzer.isActive) throw new BadRequestException('Analyzer is disabled.');

    const { token, prefix, hash } = generateToken();
    const row = await this.prisma.connectorCredential.create({
      data: { labTenantId, analyzerId, name, tokenPrefix: prefix, tokenHash: hash, createdById },
      select: { id: true, name: true, analyzerId: true, tokenPrefix: true, createdAt: true },
    });
    return { ...row, token };
  }

  list(labTenantId: string) {
    return this.prisma.connectorCredential.findMany({
      where: { labTenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        analyzerId: true,
        tokenPrefix: true,
        createdAt: true,
        lastSeenAt: true,
        lastSeenAddress: true,
        revokedAt: true,
        analyzer: { select: { name: true } },
      },
    });
  }

  /** Immediate and permanent: the next request with this token is refused. Idempotent. */
  async revoke(labTenantId: string, id: string, revokedById: string) {
    const credential = await this.prisma.connectorCredential.findFirst({
      where: { id, labTenantId },
      select: { id: true, revokedAt: true },
    });
    if (!credential) throw new NotFoundException('Credential not found.');
    if (credential.revokedAt) return { id, revokedAt: credential.revokedAt };
    return this.prisma.connectorCredential.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById },
      select: { id: true, revokedAt: true },
    });
  }

  /** null for anything that is not a valid, unrevoked credential of an active analyzer. */
  async authenticate(token: string | undefined, address?: string): Promise<ConnectorContext | null> {
    const parsed = parseToken(token);
    if (!parsed || !token) return null;
    const row = await this.prisma.connectorCredential.findUnique({
      where: { tokenPrefix: parsed.prefix },
      select: {
        id: true,
        name: true,
        labTenantId: true,
        analyzerId: true,
        tokenHash: true,
        revokedAt: true,
        lastSeenAt: true,
        analyzer: { select: { name: true, isActive: true, labTenantId: true } },
      },
    });
    if (!row || row.revokedAt || !tokenMatches(token, row.tokenHash)) return null;
    // Defense in depth: the analyzer must still belong to the credential's lab.
    if (!row.analyzer.isActive || row.analyzer.labTenantId !== row.labTenantId) return null;

    if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      void this.prisma.connectorCredential
        .update({ where: { id: row.id }, data: { lastSeenAt: new Date(), lastSeenAddress: address ?? null } })
        .catch(() => undefined);
    }
    return {
      credentialId: row.id,
      credentialName: row.name,
      labTenantId: row.labTenantId,
      analyzerId: row.analyzerId,
      analyzerName: row.analyzer.name,
    };
  }
}
