import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type {
  IncompleteMeta,
  MessageStore,
  ReceivedFrameMeta,
} from './message-store';

/**
 * Uploads what the receiver saved to the KesherIO API, independently of the
 * receiver: capture never waits for the network, and a network that is down
 * for days only means a longer queue.
 *
 * State lives on disk, next to each saved file:
 *   <base>.uploaded.json   the API confirmed it stored these exact bytes
 *   <base>.rejected.json   the API refused it for good (kept locally, never retried)
 * A file with neither marker is pending — so a restart, a crash or a reboot
 * resumes exactly where it stopped. Uploads are sequential, oldest first.
 *
 * Duplicate protection: the server keys on sha256 of the exact bytes, so
 * sending a file twice (a retry after a lost response) is harmless.
 */

export interface UploaderOptions {
  store: MessageStore;
  apiUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** retry delays, ms. Defaults 2s doubling to 5 min. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** while the credential is refused (401/403) re-check this often. */
  authRetryMs?: number;
  requestTimeoutMs?: number;
  /** how often to re-check reachability + credential while nothing is queued. Default 60 s. */
  heartbeatMs?: number;
  /** after this many 400/413/422 answers for the SAME file it is rejected for good. */
  maxPermanentFailures?: number;
  random?: () => number;
}

export type UploadState = 'idle' | 'uploading' | 'offline' | 'auth-failed';

export interface UploaderStatus {
  enabled: true;
  state: UploadState;
  pending: number;
  uploaded: number;
  rejected: number;
  /** pending files that are failing on their own while the server is otherwise reachable */
  failing: number;
  lastUploadAt: string | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  /** from /ping: what the credential is bound to */
  authenticatedAs: string | null;
}

export interface UploaderEvents {
  uploaded: [
    {
      id: string;
      serverId: string;
      status: string;
      duplicateUpload: boolean;
      complete: boolean;
    }
  ];
  rejected: [{ id: string; httpStatus: number; error: string }];
  status: [UploaderStatus];
}

interface Item {
  base: string; // absolute path without extension
  dataFile: string;
  metaFile: string;
  complete: boolean;
}

const PERMANENT = new Set([400, 413, 422]);
const API_PATH = '/api/instrument-ingest';

export class Uploader extends EventEmitter<UploaderEvents> {
  private readonly fetchImpl: typeof fetch;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly authRetry: number;
  private readonly timeout: number;
  private readonly maxPermanent: number;
  private readonly random: () => number;
  private readonly root: string;

  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly heartbeatMs: number;
  private running = false;
  private stopped = false;
  private failures = 0;
  /** per-file failure state, so one bad file backs off alone instead of blocking the queue */
  private itemState = new Map<
    string,
    { count: number; nextAt: number; error: string }
  >();
  private state: UploadState = 'idle';
  private lastUploadAt: string | null = null;
  private lastError: string | null = null;
  private nextAttemptAt: string | null = null;
  private authenticatedAs: string | null = null;
  private uploaded = 0;
  private rejected = 0;

  constructor(private readonly opts: UploaderOptions) {
    super();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseDelay = opts.baseDelayMs ?? 2_000;
    this.maxDelay = opts.maxDelayMs ?? 300_000;
    this.authRetry = opts.authRetryMs ?? 300_000;
    this.timeout = opts.requestTimeoutMs ?? 60_000;
    this.heartbeatMs = opts.heartbeatMs ?? 60_000;
    this.maxPermanent = opts.maxPermanentFailures ?? 3;
    this.random = opts.random ?? Math.random;
    this.root = opts.apiUrl.replace(/\/+$/, '') + API_PATH;
    this.uploaded = this.countMarkers('.uploaded.json');
    this.rejected = this.countMarkers('.rejected.json');
  }

  get status(): UploaderStatus {
    const pending = this.scan();
    return {
      enabled: true,
      state: this.state,
      pending: pending.length,
      uploaded: this.uploaded,
      rejected: this.rejected,
      failing: pending.filter((i) => this.itemState.has(i.base)).length,
      lastUploadAt: this.lastUploadAt,
      // A later success must not hide a file that is still failing.
      lastError:
        this.lastError ??
        [...this.itemState.values()].find(() => true)?.error ??
        null,
      nextAttemptAt: this.nextAttemptAt,
      authenticatedAs: this.authenticatedAs,
    };
  }

  /** Begin: verify the credential (non-fatal if offline) and drain whatever is pending. */
  start(): void {
    this.stopped = false;
    void this.ping();
    this.kick();
    // Even with nothing queued, notice a server that is down or a credential that was revoked.
    this.heartbeat = setInterval(() => void this.ping(), this.heartbeatMs);
    this.heartbeat.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** New data arrived (or time to retry): run the drain loop now unless it is already running. */
  kick(): void {
    if (this.stopped || this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextAttemptAt = null;
    void this.drain();
  }

  /** Resolves when the queue is empty or a retry has been scheduled. For tests and shutdown. */
  async drain(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      let consecutiveItemFailures = 0;
      for (;;) {
        const all = this.scan();
        if (all.length === 0) {
          this.setState('idle');
          this.failures = 0;
          return;
        }
        const now = Date.now();
        const item = all.find(
          (i) => (this.itemState.get(i.base)?.nextAt ?? 0) <= now
        );
        if (!item) {
          // Every pending file is backing off on its own: wake up when the first is due.
          this.scheduleAt(
            Math.min(
              ...all.map((i) => this.itemState.get(i.base)?.nextAt ?? now)
            )
          );
          return;
        }
        this.setState('uploading');
        const outcome = await this.send(item);
        if (outcome === 'done') {
          this.failures = 0;
          consecutiveItemFailures = 0;
          continue;
        }
        if (outcome === 'skip') continue; // permanently rejected: go on with the next file
        if (outcome === 'item-failed') {
          // The server is reachable and the credential fine, so this file alone is the problem:
          // it backs off by itself and the files behind it go ahead. Many in a row means the
          // server is struggling, not the files — then slow everything down.
          if (++consecutiveItemFailures >= 5) {
            this.scheduleRetry('offline');
            return;
          }
          continue;
        }
        this.scheduleRetry(outcome);
        return;
      }
    } finally {
      this.running = false;
    }
  }

  // ── one file ─────────────────────────────────────────────────────────────

  private async send(
    item: Item
  ): Promise<'done' | 'skip' | 'item-failed' | 'offline' | 'auth-failed'> {
    let bytes: Buffer;
    let meta: ReceivedFrameMeta | IncompleteMeta;
    try {
      bytes = readFileSync(item.dataFile);
      meta = JSON.parse(readFileSync(item.metaFile, 'utf8'));
    } catch (err) {
      return this.itemFailed(
        item,
        `cannot read ${item.dataFile}: ${(err as Error).message}`
      );
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== meta.sha256) {
      // The local copy changed after it was saved. Never send something we can't vouch for.
      this.reject(
        item,
        meta.id,
        0,
        'local file does not match its recorded sha256'
      );
      return 'skip';
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.root}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.token}`,
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'gzip',
          'X-Content-SHA256': sha256,
          'X-Received-At': meta.receivedAt,
          'X-Transfer-Status': item.complete ? 'complete' : 'incomplete',
          ...(!item.complete && {
            'X-Incomplete-Reason': (meta as IncompleteMeta).reason,
          }),
          'X-Local-Id': meta.id,
          ...(meta.remoteAddress && { 'X-Remote-Address': meta.remoteAddress }),
          'User-Agent': 'vh30-connector/0.1',
        },
        body: new Uint8Array(gzipSync(bytes)),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      return this.afterTransient(item, `network: ${(err as Error).message}`);
    }

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        status?: string;
        duplicateUpload?: boolean;
      };
      this.markUploaded(item, meta.id, body);
      this.lastError = null;
      return 'done';
    }
    const text = await response.text().catch(() => '');
    const detail = `HTTP ${response.status}${
      text ? `: ${text.slice(0, 200)}` : ''
    }`;
    if (response.status === 401 || response.status === 403) {
      this.lastError = `credential refused (${detail})`;
      return 'auth-failed';
    }
    if (PERMANENT.has(response.status)) {
      // The server read it and said no. Only after several identical answers is it rejected for good.
      if (
        (this.itemState.get(item.base)?.count ?? 0) + 1 >=
        this.maxPermanent
      ) {
        this.reject(item, meta.id, response.status, detail);
        return 'skip';
      }
      return this.itemFailed(item, detail);
    }
    // 5xx, 429, 404 (API not deployed yet / wrong URL), proxies…: keep the file, try again later.
    return this.afterTransient(item, detail);
  }

  /**
   * A transient failure for one file. Ask the server whether it is healthy: if it is, the problem
   * is this file (it backs off alone); if not, the whole queue waits.
   */
  private async afterTransient(
    item: Item,
    message: string
  ): Promise<'item-failed' | 'offline' | 'auth-failed'> {
    const health = await this.probe();
    if (health === 'auth') {
      this.lastError = 'credential refused';
      return 'auth-failed';
    }
    if (health === 'down') {
      this.lastError = message;
      return 'offline';
    }
    return this.itemFailed(item, message);
  }

  private itemFailed(item: Item, message: string): 'item-failed' {
    const count = (this.itemState.get(item.base)?.count ?? 0) + 1;
    const exp = Math.min(
      this.maxDelay,
      this.baseDelay * 2 ** Math.min(count - 1, 20)
    );
    const delay = Math.round(exp * (0.8 + this.random() * 0.4));
    this.itemState.set(item.base, {
      count,
      nextAt: Date.now() + delay,
      error: message,
    });
    this.lastError = `${item.base.split(/[\\/]/).pop()}: ${message}`;
    this.emit('status', this.status);
    return 'item-failed';
  }

  /** Is the server reachable with a valid credential? No side effects on queue state. */
  private async probe(): Promise<'ok' | 'auth' | 'down'> {
    try {
      const r = await this.fetchImpl(`${this.root}/ping`, {
        headers: { Authorization: `Bearer ${this.opts.token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) return 'ok';
      return r.status === 401 || r.status === 403 ? 'auth' : 'down';
    } catch {
      return 'down';
    }
  }

  private scheduleRetry(kind: 'offline' | 'auth-failed'): void {
    this.failures++;
    const exp = Math.min(
      this.maxDelay,
      this.baseDelay * 2 ** Math.min(this.failures - 1, 20)
    );
    const delay =
      kind === 'auth-failed'
        ? this.authRetry
        : Math.round(exp * (0.8 + this.random() * 0.4));
    this.setState(kind);
    this.nextAttemptAt = new Date(Date.now() + delay).toISOString();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.nextAttemptAt = null;
      if (kind === 'auth-failed') void this.ping();
      void this.drain();
    }, delay);
    this.timer.unref?.();
    this.emit('status', this.status);
  }

  /** Wake the drain loop at an absolute time (all pending files are backing off individually). */
  private scheduleAt(when: number): void {
    const delay = Math.max(50, when - Date.now());
    this.setState('offline');
    this.nextAttemptAt = new Date(when).toISOString();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.nextAttemptAt = null;
      void this.drain();
    }, delay);
    this.timer.unref?.();
    this.emit('status', this.status);
  }

  /** Checks the server is reachable and the credential still valid. Never touches the queue's retry timing. */
  private async ping(): Promise<void> {
    if (this.stopped) return;
    try {
      const r = await this.fetchImpl(`${this.root}/ping`, {
        headers: { Authorization: `Bearer ${this.opts.token}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) {
        const b = (await r.json()) as {
          analyzer?: string;
          credential?: string;
        };
        this.authenticatedAs = `${b.analyzer ?? '?'} (${b.credential ?? '?'})`;
        if (
          !this.running &&
          (this.state === 'offline' || this.state === 'auth-failed')
        ) {
          this.lastError = null;
          if (this.scan().length > 0) this.kick();
          else this.setState('idle');
        }
      } else if (r.status === 401 || r.status === 403) {
        this.authenticatedAs = null;
        this.lastError = `credential refused (HTTP ${r.status})`;
        this.setState('auth-failed');
      }
    } catch (err) {
      // Offline with nothing queued: say so rather than a reassuring "up to date".
      if (!this.running && this.state === 'idle') {
        this.lastError = `cannot reach the server: ${(err as Error).message}`;
        this.setState('offline');
      }
    }
    this.emit('status', this.status);
  }

  // ── markers + scanning ───────────────────────────────────────────────────

  private markUploaded(
    item: Item,
    id: string,
    body: { id?: string; status?: string; duplicateUpload?: boolean }
  ): void {
    atomicJson(`${item.base}.uploaded.json`, {
      uploadedAt: new Date().toISOString(),
      serverId: body.id ?? null,
      serverStatus: body.status ?? null,
      duplicateUpload: body.duplicateUpload ?? false,
    });
    this.uploaded++;
    this.lastUploadAt = new Date().toISOString();
    this.itemState.delete(item.base);
    this.emit('uploaded', {
      id,
      serverId: body.id ?? '',
      status: body.status ?? '',
      duplicateUpload: body.duplicateUpload ?? false,
      complete: item.complete,
    });
    this.emit('status', this.status);
  }

  private reject(
    item: Item,
    id: string,
    httpStatus: number,
    error: string
  ): void {
    this.itemState.delete(item.base);
    atomicJson(`${item.base}.rejected.json`, {
      rejectedAt: new Date().toISOString(),
      httpStatus,
      error,
    });
    this.rejected++;
    this.lastError = `rejected ${id}: ${error}`;
    this.emit('rejected', { id, httpStatus, error });
    this.emit('status', this.status);
  }

  /** Files without an uploaded/rejected marker, oldest first. */
  private scan(): Item[] {
    const items: Item[] = [];
    const { inboxDir, incompleteDir } = this.opts.store;
    const days = existsSync(inboxDir)
      ? readdirSync(inboxDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort()
      : [];
    for (const day of days) {
      const dir = join(inboxDir, day);
      for (const f of readdirSync(dir)
        .filter((n) => n.endsWith('.frame'))
        .sort()) {
        items.push(
          this.item(join(dir, f.slice(0, -'.frame'.length)), '.frame', true)
        );
      }
    }
    if (existsSync(incompleteDir)) {
      for (const f of readdirSync(incompleteDir)
        .filter((n) => n.endsWith('.bin'))
        .sort()) {
        items.push(
          this.item(
            join(incompleteDir, f.slice(0, -'.bin'.length)),
            '.bin',
            false
          )
        );
      }
    }
    // Chronological across both kinds: file names start with a timestamp
    return items
      .filter(
        (i) =>
          existsSync(i.metaFile) &&
          !existsSync(`${i.base}.uploaded.json`) &&
          !existsSync(`${i.base}.rejected.json`)
      )
      .sort((a, b) => stamp(a.base).localeCompare(stamp(b.base)));
  }

  private item(base: string, ext: string, complete: boolean): Item {
    return {
      base,
      dataFile: `${base}${ext}`,
      metaFile: `${base}.json`,
      complete,
    };
  }

  private countMarkers(suffix: string): number {
    const { inboxDir, incompleteDir } = this.opts.store;
    let n = 0;
    const dirs = [incompleteDir];
    if (existsSync(inboxDir))
      for (const d of readdirSync(inboxDir, { withFileTypes: true }))
        if (d.isDirectory()) dirs.push(join(inboxDir, d.name));
    for (const dir of dirs)
      if (existsSync(dir))
        n += readdirSync(dir).filter((f) => f.endsWith(suffix)).length;
    return n;
  }

  private setState(next: UploadState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('status', this.status);
  }
}

/** Sort key: the time part of the file name (inbox: day dir + HHMMSSmmm, incomplete: yyyymmdd-hhmmssmmm). */
function stamp(base: string): string {
  const name = base.split(/[\\/]/).pop() ?? base;
  const dir = base.split(/[\\/]/).slice(-2, -1)[0] ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(dir)
    ? `${dir.replace(/-/g, '')}${name}`
    : name.replace('-', '');
}

function atomicJson(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}
