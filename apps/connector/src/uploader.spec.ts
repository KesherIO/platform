import {
  mkdtempSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { summarizeHl7 } from './hl7-summary';
import { MessageStore } from './message-store';
import { Uploader } from './uploader';
import { hl7For, makeFrame } from './test-helpers';

const TOKEN = 'kvc_0123abcd_' + 'A'.repeat(43);
const ctx = { remoteAddress: '192.168.5.14', remotePort: 5000 };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const frameFor = (sample: string, control: string) =>
  makeFrame(hl7For(sample, control));

interface Seen {
  url: string;
  headers: Headers;
  body: Buffer;
}
type Reply = { status: number; json?: unknown } | 'network-error';

/** A fake `fetch` recording each request; `reply` decides the answer. */
function fakeFetch(reply: (req: Seen, n: number) => Reply) {
  const seen: Seen[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const req: Seen = {
      url: String(url),
      headers: new Headers(init?.headers),
      body: Buffer.from((init?.body as Uint8Array | undefined) ?? []),
    };
    seen.push(req);
    const r = reply(req, seen.length);
    if (r === 'network-error') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status });
  }) as typeof fetch;
  return { impl, seen };
}
const okReply = (req: Seen): Reply => ({
  status: 200,
  json: {
    id: `srv-${sha(gunzipSync(req.body)).slice(0, 6)}`,
    status: 'UNMATCHED',
    duplicateUpload: false,
  },
});

describe('Uploader', () => {
  let dir: string;
  let store: MessageStore;
  const uploaders: Uploader[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vh30-up-'));
    store = new MessageStore(dir);
  });
  afterEach(() => {
    uploaders.splice(0).forEach((u) => u.stop());
    rmSync(dir, { recursive: true, force: true });
  });

  const make = (impl: typeof fetch, over = {}) => {
    const u = new Uploader({
      store,
      apiUrl: 'https://api.example.com/',
      token: TOKEN,
      fetchImpl: impl,
      baseDelayMs: 5,
      maxDelayMs: 20,
      authRetryMs: 30,
      random: () => 0.5,
      ...over,
    });
    uploaders.push(u);
    return u;
  };
  const save = (sample: string, control: string, at: Date) => {
    const f = frameFor(sample, control);
    return {
      frame: f,
      meta: store.saveFrame(f, summarizeHl7(f.subarray(5, -2)), ctx, at),
    };
  };
  const waitFor = (cond: () => boolean, ms = 3000) =>
    vi.waitFor(
      () => {
        if (!cond()) throw new Error('not yet');
      },
      { timeout: ms, interval: 5 }
    );
  const markers = (suffix: string) =>
    readdirSync(store.inboxDir, { recursive: true, encoding: 'utf8' }).filter(
      (f) => f.endsWith(suffix)
    );

  it('uploads oldest first with auth, an integrity hash and the exact bytes (gzip), then marks each uploaded', async () => {
    const second = save('169', '2574', new Date('2026-10-21T10:00:02Z'));
    const first = save('168', '2577', new Date('2026-10-21T10:00:01Z'));
    const { impl, seen } = fakeFetch(okReply);
    const u = make(impl);
    await u.drain();

    const posts = seen.filter((r) => r.url.endsWith('/messages'));
    expect(
      posts.map((r) =>
        gunzipSync(r.body).equals(first.frame) ? 'first' : 'second'
      )
    ).toEqual(['first', 'second']);
    expect(posts[0].url).toBe(
      'https://api.example.com/api/instrument-ingest/messages'
    );
    expect(posts[0].headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(posts[0].headers.get('content-encoding')).toBe('gzip');
    expect(posts[0].headers.get('x-content-sha256')).toBe(first.meta.sha256);
    expect(posts[0].headers.get('x-transfer-status')).toBe('complete');
    expect(posts[0].headers.get('x-received-at')).toBe(
      '2026-10-21T10:00:01.000Z'
    );
    expect(second.meta.sha256).toBe(posts[1].headers.get('x-content-sha256'));
    expect(markers('.uploaded.json')).toHaveLength(2);
    expect(u.status).toMatchObject({
      state: 'idle',
      pending: 0,
      uploaded: 2,
      rejected: 0,
    });
  });

  it('uploads interrupted transfers flagged incomplete, with the reason', async () => {
    const f = frameFor('168', '2577');
    const meta = store.saveIncomplete(
      f.subarray(0, 300),
      'trailing-partial',
      ctx
    );
    const { impl, seen } = fakeFetch(okReply);
    await make(impl).drain();
    const post = seen.find((r) => r.url.endsWith('/messages'))!;
    expect(post.headers.get('x-transfer-status')).toBe('incomplete');
    expect(post.headers.get('x-incomplete-reason')).toBe('trailing-partial');
    expect(post.headers.get('x-local-id')).toBe(meta.id);
    expect(gunzipSync(post.body).equals(f.subarray(0, 300))).toBe(true);
  });

  it('keeps everything while offline, retries with backoff, and sends it all once the network returns', async () => {
    save('168', '2577', new Date('2026-10-21T10:00:01Z'));
    save('169', '2574', new Date('2026-10-21T10:00:02Z'));
    let online = false;
    const { impl, seen } = fakeFetch((req) =>
      online ? okReply(req) : 'network-error'
    );
    const u = make(impl);
    u.start();
    await waitFor(() => u.status.state === 'offline' && seen.length >= 3); // retried more than once
    expect(u.status).toMatchObject({ pending: 2, uploaded: 0 });
    expect(u.status.lastError).toMatch(/network/);
    expect(u.status.nextAttemptAt).not.toBeNull();

    online = true;
    await waitFor(() => u.status.uploaded === 2);
    expect(u.status).toMatchObject({ state: 'idle', pending: 0 });
    expect(markers('.uploaded.json')).toHaveLength(2);
  });

  it('survives a restart: nothing already uploaded is sent again, the rest is', async () => {
    save('168', '2577', new Date('2026-10-21T10:00:01Z'));
    const a = fakeFetch(okReply);
    await make(a.impl).drain();
    expect(a.seen.filter((r) => r.url.endsWith('/messages'))).toHaveLength(1);

    save('169', '2574', new Date('2026-10-21T10:00:02Z')); // arrives "while the app was closed"
    const b = fakeFetch(okReply);
    const restarted = make(b.impl);
    expect(restarted.status).toMatchObject({ pending: 1, uploaded: 1 });
    await restarted.drain();
    expect(b.seen.filter((r) => r.url.endsWith('/messages'))).toHaveLength(1);
    expect(restarted.status).toMatchObject({ pending: 0, uploaded: 2 });
  });

  it("a lost response is harmless: the retry sends the same bytes and the server's duplicate answer completes it", async () => {
    const { frame } = save('168', '2577', new Date('2026-10-21T10:00:01Z'));
    let posts = 0; // the response to the FIRST upload is lost (server stored it, connector never heard)
    const { impl, seen } = fakeFetch((r) =>
      r.url.endsWith('/messages') && ++posts === 1
        ? 'network-error'
        : {
            status: 200,
            json: { id: 'srv1', status: 'IMPORTED', duplicateUpload: true },
          }
    );
    const u = make(impl);
    u.start();
    await waitFor(() => u.status.uploaded === 1);
    const sent = seen.filter((r) => r.url.endsWith('/messages'));
    expect(sent).toHaveLength(2);
    expect(sent.every((p) => gunzipSync(p.body).equals(frame))).toBe(true);
    expect(markers('.uploaded.json')).toHaveLength(1);
    expect(
      JSON.parse(
        readFileSync(join(store.inboxDir, markers('.uploaded.json')[0]), 'utf8')
      )
    ).toMatchObject({ serverId: 'srv1', duplicateUpload: true });
  });

  it('a refused credential pauses uploading visibly, keeps the data, and resumes when it is accepted', async () => {
    save('168', '2577', new Date('2026-10-21T10:00:01Z'));
    let valid = false;
    const { impl } = fakeFetch((req) =>
      valid
        ? req.url.endsWith('/ping')
          ? { status: 200, json: { analyzer: 'VH30', credential: 'Lab PC' } }
          : okReply(req)
        : {
            status: 401,
            json: { message: 'Invalid or revoked connector credential.' },
          }
    );
    const u = make(impl);
    u.start();
    await waitFor(() => u.status.state === 'auth-failed');
    expect(u.status).toMatchObject({ pending: 1, uploaded: 0 });
    expect(u.status.lastError).toMatch(/credential refused/);

    valid = true;
    await waitFor(() => u.status.uploaded === 1);
    expect(u.status.authenticatedAs).toBe('VH30 (Lab PC)');
  });

  it('rejects a file only after repeated 400s, then carries on with the next one; 5xx and 404 never reject', async () => {
    const bad = save('168', '2577', new Date('2026-10-21T10:00:01Z'));
    save('169', '2574', new Date('2026-10-21T10:00:02Z'));
    const { impl } = fakeFetch((req) =>
      gunzipSync(req.body).equals(bad.frame)
        ? { status: 400, json: { message: 'bad' } }
        : okReply(req)
    );
    const u = make(impl, { maxPermanentFailures: 3 });
    u.start();
    await waitFor(() => u.status.rejected === 1 && u.status.uploaded === 1);
    expect(markers('.rejected.json')).toHaveLength(1);
    expect(existsSync(join(store.inboxDir, markers('.frame')[0]))).toBe(true); // bytes still kept locally

    // 404 (API not deployed / wrong URL) and 500 are retried forever, never rejected
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'vh30-up-'));
    store = new MessageStore(dir);
    save('170', '2590', new Date('2026-10-21T10:00:03Z'));
    let status = 404;
    const f2 = fakeFetch((req) => (status === 200 ? okReply(req) : { status }));
    const u2 = make(f2.impl);
    u2.start();
    await waitFor(() => f2.seen.length >= 4);
    status = 500;
    await waitFor(() => f2.seen.length >= 6);
    expect(u2.status).toMatchObject({ rejected: 0, pending: 1 });
    status = 200;
    await waitFor(() => u2.status.uploaded === 1);
  });

  it('never sends a file that no longer matches its recorded hash', async () => {
    const { meta } = save('168', '2577', new Date('2026-10-21T10:00:01Z'));
    const day = readdirSync(store.inboxDir)[0];
    writeFileSync(
      join(store.inboxDir, day, meta.frameFile),
      Buffer.from('tampered')
    );
    const { impl, seen } = fakeFetch(okReply);
    const u = make(impl);
    await u.drain();
    expect(seen.filter((r) => r.url.endsWith('/messages'))).toHaveLength(0);
    expect(u.status.rejected).toBe(1);
    expect(u.status.lastError).toMatch(/sha256/);
  });

  it('uploads a new message as soon as it is kicked, without waiting for a timer', async () => {
    const { impl, seen } = fakeFetch(okReply);
    const u = make(impl);
    u.start();
    await waitFor(() => u.status.state === 'idle');
    save('168', '2577', new Date());
    u.kick();
    await waitFor(() => u.status.uploaded === 1);
    expect(seen.filter((r) => r.url.endsWith('/messages'))).toHaveLength(1);
  });

  it('with nothing queued, notices an unreachable server and a revoked credential instead of claiming "up to date"', async () => {
    let mode: 'down' | 'up' | 'revoked' = 'down';
    const { impl } = fakeFetch((req) =>
      mode === 'down'
        ? 'network-error'
        : mode === 'revoked'
        ? { status: 401 }
        : req.url.endsWith('/ping')
        ? { status: 200, json: { analyzer: 'VH30', credential: 'PC' } }
        : okReply(req)
    );
    const u = make(impl, { heartbeatMs: 10 });
    u.start();
    await waitFor(() => u.status.state === 'offline');
    expect(u.status.lastError).toMatch(/cannot reach the server/);
    mode = 'up';
    await waitFor(
      () =>
        u.status.state === 'idle' && u.status.authenticatedAs === 'VH30 (PC)'
    );
    mode = 'revoked';
    await waitFor(() => u.status.state === 'auth-failed');
    mode = 'up';
    await waitFor(() => u.status.state === 'idle');
    expect(u.status.lastError).toBeNull();
  });

  it('when the heartbeat sees the server return, it kicks off the queued uploads', async () => {
    save('168', '2577', new Date('2026-10-21T10:00:01Z'));
    let up = false;
    const { impl } = fakeFetch((req) =>
      up
        ? req.url.endsWith('/ping')
          ? { status: 200, json: { analyzer: 'a', credential: 'c' } }
          : okReply(req)
        : 'network-error'
    );
    const u = make(impl, {
      heartbeatMs: 10,
      baseDelayMs: 100000,
      maxDelayMs: 100000,
    }); // retry timer far away: only the heartbeat can resume it
    u.start();
    await waitFor(() => u.status.state === 'offline');
    up = true;
    await waitFor(() => u.status.uploaded === 1);
  });

  describe('a poison file never blocks the queue behind it', () => {
    const isPing = (r: Seen) => r.url.endsWith('/ping');
    const pingOk: Reply = {
      status: 200,
      json: { analyzer: 'VH30', credential: 'PC' },
    };

    it('a file the server keeps failing on (HTTP 500) backs off alone while later files upload', async () => {
      const poison = save('168', '2577', new Date('2026-10-21T10:00:01Z'));
      save('169', '2574', new Date('2026-10-21T10:00:02Z'));
      save('170', '2590', new Date('2026-10-21T10:00:03Z'));
      let fixed = false;
      const { impl, seen } = fakeFetch((r) =>
        isPing(r)
          ? pingOk
          : !fixed && gunzipSync(r.body).equals(poison.frame)
          ? { status: 500, json: { message: 'boom' } }
          : okReply(r)
      );
      const u = make(impl);
      u.start();
      await waitFor(() => u.status.uploaded === 2);
      expect(u.status).toMatchObject({ pending: 1, failing: 1, rejected: 0 });
      expect(u.status.lastError).toMatch(/HTTP 500/);
      const posts = seen.filter((r) => r.url.endsWith('/messages'));
      expect(
        posts.filter((p) => gunzipSync(p.body).equals(poison.frame)).length
      ).toBeLessThan(6); // backing off, not hammering

      fixed = true; // the bug is fixed server-side: it is retried automatically and goes through
      await waitFor(() => u.status.uploaded === 3);
      expect(u.status).toMatchObject({ pending: 0, failing: 0 });
    });

    it('a file that makes the request hang/fail at the network level is also isolated when the server is otherwise healthy', async () => {
      const poison = save('168', '2577', new Date('2026-10-21T10:00:01Z'));
      save('169', '2574', new Date('2026-10-21T10:00:02Z'));
      const { impl } = fakeFetch((r) =>
        isPing(r)
          ? pingOk
          : gunzipSync(r.body).equals(poison.frame)
          ? 'network-error'
          : okReply(r)
      );
      const u = make(impl);
      u.start();
      await waitFor(() => u.status.uploaded === 1);
      expect(u.status).toMatchObject({ pending: 1, failing: 1 });
      expect(u.status.state).not.toBe('auth-failed');
    });

    it('the poison file is kept on disk, never rejected, and shown as failing', async () => {
      const poison = save('168', '2577', new Date('2026-10-21T10:00:01Z'));
      const { impl } = fakeFetch((r) => (isPing(r) ? pingOk : { status: 502 }));
      const u = make(impl);
      u.start();
      await waitFor(() => u.status.failing === 1);
      expect(existsSync(join(store.inboxDir, markers('.frame')[0]))).toBe(true);
      expect(markers('.rejected.json')).toHaveLength(0);
      expect(poison.meta.sha256).toHaveLength(64);
    });

    it('if the server is down (ping fails too) the whole queue waits instead — that is an outage, not a bad file', async () => {
      save('168', '2577', new Date('2026-10-21T10:00:01Z'));
      save('169', '2574', new Date('2026-10-21T10:00:02Z'));
      const { impl, seen } = fakeFetch(() => ({ status: 503 }));
      const u = make(impl);
      u.start();
      await waitFor(() => u.status.state === 'offline');
      expect(u.status).toMatchObject({ pending: 2, failing: 0 });
      expect(
        seen.filter((r) => r.url.endsWith('/messages')).length
      ).toBeLessThanOrEqual(3); // stopped after the first failure of a pass
    });

    it('many different files failing while the server claims to be healthy slows everything down rather than hammering', async () => {
      for (let i = 0; i < 12; i++)
        save(
          String(100 + i),
          String(3000 + i),
          new Date(`2026-10-21T10:00:${String(10 + i).padStart(2, '0')}Z`)
        );
      const { impl, seen } = fakeFetch((r) =>
        isPing(r) ? pingOk : { status: 500 }
      );
      const u = make(impl, { baseDelayMs: 1000, maxDelayMs: 1000 });
      u.start();
      await waitFor(() => u.status.state === 'offline');
      await new Promise((r) => setTimeout(r, 100));
      expect(
        seen.filter((r) => r.url.endsWith('/messages')).length
      ).toBeLessThanOrEqual(6); // gave up the pass after 5 in a row
      expect(u.status.pending).toBe(12);
    });
  });

  describe('over real HTTP', () => {
    let server: Server;
    let url: string;
    const got: Array<{
      headers: Record<string, string | string[] | undefined>;
      body: Buffer;
    }> = [];
    beforeEach(async () => {
      got.length = 0;
      server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          got.push({ headers: req.headers, body: Buffer.concat(chunks) });
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              id: 'srv',
              status: 'UNMATCHED',
              duplicateUpload: false,
            })
          );
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(() => new Promise<void>((r) => server.close(() => r())));

    it('delivers the exact frame, gzip-encoded, to a plain HTTP listener', async () => {
      const { frame, meta } = save('168', '2577', new Date());
      const u = make(fetch, { apiUrl: url });
      await u.drain();
      const post = got.find((g) => g.headers['x-content-sha256'])!;
      expect(post.headers['content-encoding']).toBe('gzip');
      expect(post.headers['x-content-sha256']).toBe(meta.sha256);
      expect(gunzipSync(post.body).equals(frame)).toBe(true);
      expect(u.status.uploaded).toBe(1);
    });
  });
});
