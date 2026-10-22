import {
  generateToken,
  hashToken,
  parseToken,
  tokenMatches,
} from './connector-token.util';

describe('connector token', () => {
  it('has the kvc_<prefix>_<secret> shape and parses back to its prefix', () => {
    const t = generateToken();
    expect(t.token).toMatch(/^kvc_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    expect(parseToken(t.token)).toEqual({ prefix: t.prefix });
  });
  it('is unique and stores only a sha256 of the token', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).toHaveLength(64);
    expect(a.hash).not.toContain(a.token);
  });
  it('matches only the exact token', () => {
    const t = generateToken();
    expect(tokenMatches(t.token, t.hash)).toBe(true);
    expect(tokenMatches(t.token + 'x', t.hash)).toBe(false);
    expect(tokenMatches(generateToken().token, t.hash)).toBe(false);
    expect(tokenMatches(t.token, 'zz')).toBe(false);
  });
  it.each([
    undefined,
    null,
    '',
    'Bearer x',
    'kvc_short_x',
    'kvc_12345678_tooshort',
  ])('rejects malformed %p', (bad) => {
    expect(parseToken(bad as string)).toBeNull();
  });
});
