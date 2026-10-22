import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Connector credential token: `kvc_<prefix>_<secret>`.
 *  - prefix: 8 hex chars, stored in clear, used to look the credential up
 *  - secret: 32 random bytes (base64url); only sha256(token) is stored
 * The secret has 256 bits of entropy, so a plain fast hash is appropriate
 * (no password-style stretching needed) and lookups stay one indexed read.
 */
const TOKEN_RE = /^kvc_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedToken {
  token: string;
  prefix: string;
  hash: string;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export function generateToken(): GeneratedToken {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const token = `kvc_${prefix}_${secret}`;
  return { token, prefix, hash: hashToken(token) };
}

export function parseToken(token: string | undefined | null): { prefix: string } | null {
  const m = TOKEN_RE.exec(token ?? '');
  return m ? { prefix: m[1] } : null;
}

export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
