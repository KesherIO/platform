import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, loadConfig, saveConfig, validateConfig } from './config';

const TOKEN = 'kvc_0123abcd_' + 'A'.repeat(43);

describe('connector config', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'vh30-cfg-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('requires https except for localhost, and a well-formed token', () => {
    expect(
      validateConfig({ apiUrl: 'https://api.kesher.io/', token: TOKEN }).apiUrl
    ).toBe('https://api.kesher.io');
    expect(() =>
      validateConfig({ apiUrl: 'http://api.kesher.io', token: TOKEN })
    ).toThrow(/https/);
    expect(
      validateConfig({ apiUrl: 'http://localhost:3000', token: TOKEN }).apiUrl
    ).toBe('http://localhost:3000');
    expect(() => validateConfig({ apiUrl: 'nonsense', token: TOKEN })).toThrow(
      /Invalid API URL/
    );
    expect(() =>
      validateConfig({ apiUrl: 'https://x.io', token: 'abc' })
    ).toThrow(/not a connector token/);
  });

  it('is null (capture-only) when nothing is configured', () => {
    expect(loadConfig(dir, {})).toBeNull();
  });

  it('round-trips through connector.json, owner-only, and env overrides the file', () => {
    saveConfig(dir, { apiUrl: 'https://api.kesher.io', token: TOKEN });
    expect(JSON.parse(readFileSync(configPath(dir), 'utf8'))).toEqual({
      apiUrl: 'https://api.kesher.io',
      token: TOKEN,
    });
    if (process.platform !== 'win32')
      expect(statSync(configPath(dir)).mode & 0o777).toBe(0o600);
    expect(loadConfig(dir, {})).toEqual({
      apiUrl: 'https://api.kesher.io',
      token: TOKEN,
    });
    expect(
      loadConfig(dir, {
        VH30_API_URL: 'https://other.io',
        VH30_API_TOKEN: TOKEN,
      })?.apiUrl
    ).toBe('https://other.io');
  });
});
