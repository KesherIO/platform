import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { IncomingMessage } from 'node:http';
import { readRawBody } from './raw-body.util';

const req = (body: Buffer, headers: Record<string, string> = {}) =>
  Object.assign(Readable.from([body]), {
    headers,
  }) as unknown as IncomingMessage;

describe('readRawBody', () => {
  it('returns the exact bytes', async () => {
    const body = Buffer.from([0, 1, 2, 0x0b, 0xff]);
    expect((await readRawBody(req(body), 100)).equals(body)).toBe(true);
  });
  it('inflates a gzip body', async () => {
    const body = Buffer.alloc(5000, 7);
    const out = await readRawBody(
      req(gzipSync(body), { 'content-encoding': 'gzip' }),
      10_000
    );
    expect(out.equals(body)).toBe(true);
  });
  it('caps the DECOMPRESSED size (gzip bomb)', async () => {
    const bomb = gzipSync(Buffer.alloc(2_000_000));
    expect(bomb.length).toBeLessThan(5000);
    await expect(
      readRawBody(req(bomb, { 'content-encoding': 'gzip' }), 100_000)
    ).rejects.toThrow(PayloadTooLargeException);
  });
  it('rejects an oversized declared length without reading', async () => {
    await expect(
      readRawBody(req(Buffer.alloc(10), { 'content-length': '999999' }), 1000)
    ).rejects.toThrow(PayloadTooLargeException);
  });
  it('rejects unknown encodings and corrupt gzip', async () => {
    await expect(
      readRawBody(req(Buffer.alloc(1), { 'content-encoding': 'br' }), 100)
    ).rejects.toThrow(BadRequestException);
    await expect(
      readRawBody(
        req(Buffer.from('not gzip'), { 'content-encoding': 'gzip' }),
        100
      )
    ).rejects.toThrow(BadRequestException);
  });
});
