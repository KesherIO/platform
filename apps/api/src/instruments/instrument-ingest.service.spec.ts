import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConnectorContext } from './connector-credential.service';
import { InstrumentIngestService } from './instrument-ingest.service';
import type { InstrumentProcessorService } from './instrument-processor.service';
import { makeFrame, sampleHl7 } from './test-frames';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const connector: ConnectorContext = { credentialId: 'c1', credentialName: 'n', labTenantId: 'lab1', analyzerId: 'an1', analyzerName: 'VH30' };

describe('InstrumentIngestService', () => {
  const prisma = {
    instrumentMessage: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    tenant: { findUnique: jest.fn() },
  };
  const processor = { process: jest.fn() };
  const service = new InstrumentIngestService(prisma as unknown as PrismaService, processor as unknown as InstrumentProcessorService);
  const frame = makeFrame(sampleHl7());
  const input = (over = {}) => ({ connector, bytes: frame, claimedSha256: sha(frame), receivedAt: new Date(), complete: true, ...over });

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.tenant.findUnique.mockResolvedValue({ timezone: 'America/Bogota' });
    prisma.instrumentMessage.findUnique.mockResolvedValue(null);
    prisma.instrumentMessage.create.mockResolvedValue({ id: 'm1' });
    prisma.instrumentMessage.updateMany.mockResolvedValue({ count: 0 });
    processor.process.mockResolvedValue('IMPORTED');
  });

  it('rejects when the body does not match the claimed hash; nothing is stored', async () => {
    await expect(service.ingest(input({ claimedSha256: 'a'.repeat(64) }))).rejects.toThrow(BadRequestException);
    expect(prisma.instrumentMessage.create).not.toHaveBeenCalled();
  });

  it('returns the original record for a retry of the same bytes (scoped to lab + analyzer)', async () => {
    prisma.instrumentMessage.findUnique.mockResolvedValue({ id: 'old', status: 'IMPORTED' });
    expect(await service.ingest(input())).toEqual({ id: 'old', status: 'IMPORTED', duplicateUpload: true });
    expect(prisma.instrumentMessage.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { labTenantId_analyzerId_sha256: { labTenantId: 'lab1', analyzerId: 'an1', sha256: sha(frame) } } })
    );
    expect(prisma.instrumentMessage.create).not.toHaveBeenCalled();
  });

  it('stores the exact bytes gzip-compressed with the lab/analyzer from the credential, then processes', async () => {
    expect(await service.ingest(input())).toEqual({ id: 'm1', status: 'IMPORTED', duplicateUpload: false });
    const data = prisma.instrumentMessage.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ labTenantId: 'lab1', analyzerId: 'an1', credentialId: 'c1', sampleId: '168', controlId: '2577', status: 'RECEIVED', isComplete: true });
    expect(gunzipSync(data.payload.create.bytes).equals(frame)).toBe(true);
    expect(data.observationTime.toISOString()).toBe('2026-10-20T00:14:57.000Z');
    expect(processor.process).toHaveBeenCalledWith('m1');
  });

  it('an interrupted transfer is stored INCOMPLETE and is never sent to the processor', async () => {
    const r = await service.ingest(input({ bytes: Buffer.from(frame.subarray(0, 100)), claimedSha256: sha(frame.subarray(0, 100)), complete: false, incompleteReason: 'trailing-partial' }));
    expect(r.status).toBe('INCOMPLETE');
    expect(prisma.instrumentMessage.create.mock.calls[0][0].data).toMatchObject({ isComplete: false, status: 'INCOMPLETE', incompleteReason: 'trailing-partial', reasons: ['INCOMPLETE_TRANSFER'] });
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('bytes claimed complete but not a valid frame become FAILED (kept), not processed', async () => {
    const junk = Buffer.from('junk');
    const r = await service.ingest(input({ bytes: junk, claimedSha256: sha(junk) }));
    expect(r.status).toBe('FAILED');
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('a processing crash still reports success: bytes are durable, row is marked FAILED', async () => {
    processor.process.mockRejectedValue(new Error('boom'));
    expect(await service.ingest(input())).toEqual({ id: 'm1', status: 'FAILED', duplicateUpload: false });
    expect(prisma.instrumentMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1' }, data: expect.objectContaining({ status: 'FAILED', processingError: 'boom' }) })
    );
  });

  it('two racing uploads of the same bytes: the loser gets the winner back', async () => {
    prisma.instrumentMessage.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    prisma.instrumentMessage.findUniqueOrThrow.mockResolvedValue({ id: 'winner', status: 'UNMATCHED' });
    expect(await service.ingest(input())).toEqual({ id: 'winner', status: 'UNMATCHED', duplicateUpload: true });
    expect(processor.process).not.toHaveBeenCalled();
  });

  it('a complete copy settles earlier INCOMPLETE attempts of the same message', async () => {
    await service.ingest(input());
    expect(prisma.instrumentMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'INCOMPLETE', controlId: '2577', sampleId: '168', labTenantId: 'lab1' }) })
    );
  });
});
