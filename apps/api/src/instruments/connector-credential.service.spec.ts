import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { generateToken } from './connector-token.util';

describe('ConnectorCredentialService', () => {
  const prisma = {
    analyzer: { findFirst: jest.fn() },
    connectorCredential: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  };
  const service = new ConnectorCredentialService(prisma as unknown as PrismaService);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.connectorCredential.update.mockResolvedValue({});
  });

  it('create: scopes the analyzer lookup to the lab and returns the token once', async () => {
    prisma.analyzer.findFirst.mockResolvedValue({ id: 'an1', isActive: true });
    prisma.connectorCredential.create.mockImplementation(({ data }) => Promise.resolve({ id: 'c1', name: data.name, analyzerId: data.analyzerId, tokenPrefix: data.tokenPrefix, createdAt: new Date() }));
    const out = await service.create('lab1', 'an1', 'PC', 'u1');
    expect(prisma.analyzer.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'an1', labTenantId: 'lab1' } }));
    expect(out.token).toMatch(/^kvc_/);
    const stored = prisma.connectorCredential.create.mock.calls[0][0].data;
    expect(JSON.stringify(stored)).not.toContain(out.token);
  });
  it('create: unknown/other-lab analyzer is 404, disabled analyzer is 400', async () => {
    prisma.analyzer.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('lab1', 'x', 'PC', 'u1')).rejects.toThrow(NotFoundException);
    prisma.analyzer.findFirst.mockResolvedValueOnce({ id: 'an1', isActive: false });
    await expect(service.create('lab1', 'an1', 'PC', 'u1')).rejects.toThrow(BadRequestException);
  });
  it('list never selects the token hash', async () => {
    prisma.connectorCredential.findMany.mockResolvedValue([]);
    await service.list('lab1');
    expect(prisma.connectorCredential.findMany.mock.calls[0][0].select.tokenHash).toBeUndefined();
  });
  it('revoke: scoped to the lab, and idempotent', async () => {
    prisma.connectorCredential.findFirst.mockResolvedValueOnce(null);
    await expect(service.revoke('lab2', 'c1', 'u')).rejects.toThrow(NotFoundException);
    const at = new Date();
    prisma.connectorCredential.findFirst.mockResolvedValueOnce({ id: 'c1', revokedAt: at });
    await expect(service.revoke('lab1', 'c1', 'u')).resolves.toEqual({ id: 'c1', revokedAt: at });
    expect(prisma.connectorCredential.update).not.toHaveBeenCalled();
  });

  describe('authenticate', () => {
    const t = generateToken();
    const row = (over = {}) => ({
      id: 'c1', name: 'PC', labTenantId: 'lab1', analyzerId: 'an1', tokenHash: t.hash, revokedAt: null, lastSeenAt: new Date(),
      analyzer: { name: 'VH30', isActive: true, labTenantId: 'lab1' }, ...over,
    });
    it('accepts a valid token', async () => {
      prisma.connectorCredential.findUnique.mockResolvedValue(row());
      expect(await service.authenticate(t.token)).toMatchObject({ labTenantId: 'lab1', analyzerId: 'an1', analyzerName: 'VH30' });
      expect(prisma.connectorCredential.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenPrefix: t.prefix } }));
    });
    it.each([
      ['revoked', row({ revokedAt: new Date() })],
      ['analyzer disabled', row({ analyzer: { name: 'x', isActive: false, labTenantId: 'lab1' } })],
      ['analyzer moved to another lab', row({ analyzer: { name: 'x', isActive: true, labTenantId: 'lab2' } })],
      ['unknown prefix', null],
    ])('refuses %s', async (_n, r) => {
      prisma.connectorCredential.findUnique.mockResolvedValue(r);
      expect(await service.authenticate(t.token)).toBeNull();
    });
    it('refuses a right prefix with a wrong secret, and never queries for a malformed token', async () => {
      prisma.connectorCredential.findUnique.mockResolvedValue(row());
      expect(await service.authenticate(`kvc_${t.prefix}_${'A'.repeat(43)}`)).toBeNull();
      prisma.connectorCredential.findUnique.mockClear();
      expect(await service.authenticate('garbage')).toBeNull();
      expect(prisma.connectorCredential.findUnique).not.toHaveBeenCalled();
    });
    it('touches lastSeenAt at most once a minute', async () => {
      prisma.connectorCredential.findUnique.mockResolvedValue(row({ lastSeenAt: new Date() }));
      await service.authenticate(t.token);
      expect(prisma.connectorCredential.update).not.toHaveBeenCalled();
      prisma.connectorCredential.findUnique.mockResolvedValue(row({ lastSeenAt: new Date(Date.now() - 120_000) }));
      await service.authenticate(t.token, '1.2.3.4');
      expect(prisma.connectorCredential.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastSeenAddress: '1.2.3.4' }) }));
    });
  });
});
