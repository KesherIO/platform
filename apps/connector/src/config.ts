import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the connector uploads. Kept in <dataDir>/connector.json (or env), NOT in the
 * .bat file, so the token isn't left in a script. Without it the connector runs
 * capture-only: everything is saved locally and uploaded later, once configured.
 */
export interface ConnectorConfig {
  apiUrl: string;
  token: string;
}

const TOKEN_RE = /^kvc_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;

export function validateConfig(c: Partial<ConnectorConfig>): ConnectorConfig {
  let url: URL;
  try {
    url = new URL(c.apiUrl ?? '');
  } catch {
    throw new Error(`Invalid API URL: ${c.apiUrl ?? '(missing)'}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('API URL must use https:// (plain http is only allowed for localhost).');
  if (!TOKEN_RE.test(c.token ?? '')) throw new Error('Token is not a connector token (expected kvc_<8 hex>_<43 chars>).');
  return { apiUrl: url.origin + url.pathname.replace(/\/+$/, ''), token: c.token as string };
}

export function configPath(dataDir: string): string {
  return join(dataDir, 'connector.json');
}

/** env VH30_API_URL / VH30_API_TOKEN win over the file; null = capture-only mode. */
export function loadConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): ConnectorConfig | null {
  const fromEnv = { apiUrl: env['VH30_API_URL'], token: env['VH30_API_TOKEN'] };
  if (fromEnv.apiUrl || fromEnv.token) return validateConfig(fromEnv);
  const file = configPath(dataDir);
  if (!existsSync(file)) return null;
  return validateConfig(JSON.parse(readFileSync(file, 'utf8')));
}

export function saveConfig(dataDir: string, config: ConnectorConfig): void {
  const file = configPath(dataDir);
  writeFileSync(`${file}.tmp`, JSON.stringify(validateConfig(config), null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  try {
    chmodSync(file, 0o600); // no-op on Windows
  } catch {
    /* best effort */
  }
}
