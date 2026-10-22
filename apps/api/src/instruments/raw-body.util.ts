import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { createGunzip } from 'node:zlib';

/**
 * Reads an application/octet-stream request body (optionally gzip-encoded)
 * with a hard cap on the DECOMPRESSED size, so a small gzip bomb can't fill
 * memory. Used by the connector upload route instead of a global body parser.
 */
export async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const encoding = String(req.headers['content-encoding'] ?? 'identity').toLowerCase();
  if (encoding !== 'identity' && encoding !== 'gzip') {
    throw new BadRequestException(`Unsupported Content-Encoding "${encoding}"`);
  }
  const declared = Number(req.headers['content-length']);
  if (encoding === 'identity' && Number.isFinite(declared) && declared > maxBytes) {
    throw new PayloadTooLargeException(`Body larger than ${maxBytes} bytes`);
  }
  const source = encoding === 'gzip' ? req.pipe(createGunzip()) : req;
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        throw new PayloadTooLargeException(`Body larger than ${maxBytes} bytes`);
      }
      chunks.push(buf);
    }
  } catch (err) {
    if (err instanceof PayloadTooLargeException) throw err;
    throw new BadRequestException('Request body could not be read (corrupt gzip?)');
  }
  return Buffer.concat(chunks, total);
}
