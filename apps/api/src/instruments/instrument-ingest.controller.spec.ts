import { BadRequestException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { InstrumentIngestController } from './instrument-ingest.controller';
import type { InstrumentIngestService } from './instrument-ingest.service';
import type { ConnectorRequest } from './connector-auth.guard';

describe('InstrumentIngestController', () => {
  const ingest = { ingest: jest.fn() };
  const controller = new InstrumentIngestController(
    ingest as unknown as InstrumentIngestService
  );
  const connector = {
    credentialId: 'c1',
    credentialName: 'PC',
    labTenantId: 'lab1',
    analyzerId: 'an1',
    analyzerName: 'VH30',
  };
  const request = (body: Buffer) =>
    Object.assign(Readable.from([body]), {
      headers: {},
      connector,
    }) as unknown as ConnectorRequest;
  const SHA = 'a'.repeat(64);
  const AT = '2026-10-21T10:00:00.000Z';
  beforeEach(() => ingest.ingest.mockReset());

  it('ping reports what the credential is bound to', () => {
    expect(controller.ping(request(Buffer.alloc(0)))).toMatchObject({
      ok: true,
      analyzer: 'VH30',
      credential: 'PC',
    });
  });

  it('passes the body bytes and headers to the service with the lab taken from the credential', async () => {
    ingest.ingest.mockResolvedValue({
      id: 'm',
      status: 'UNMATCHED',
      duplicateUpload: false,
    });
    const body = Buffer.from([1, 2, 3]);
    await controller.upload(
      request(body),
      SHA,
      AT,
      'incomplete',
      'trailing-partial',
      'file-1',
      '192.168.5.14'
    );
    expect(ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        connector,
        claimedSha256: SHA,
        complete: false,
        incompleteReason: 'trailing-partial',
        localId: 'file-1',
        remoteAddress: '192.168.5.14',
      })
    );
    expect(ingest.ingest.mock.calls[0][0].bytes.equals(body)).toBe(true);
  });

  it.each([
    ['missing hash', undefined, AT, 'complete'],
    ['short hash', 'abc', AT, 'complete'],
    ['missing time', SHA, undefined, 'complete'],
    ['bad time', SHA, 'yesterday', 'complete'],
    ['bad transfer status', SHA, AT, 'maybe'],
    ['missing transfer status', SHA, AT, undefined],
  ])('400 on %s', async (_n, sha, at, status) => {
    await expect(
      controller.upload(
        request(Buffer.from('x')),
        sha,
        at,
        status,
        undefined,
        undefined,
        undefined
      )
    ).rejects.toThrow(BadRequestException);
    expect(ingest.ingest).not.toHaveBeenCalled();
  });
});
