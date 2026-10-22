import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
} from 'node:http';
import { createConnection, type AddressInfo } from 'node:net';
import { createIngestProxy } from './ingest-proxy';

const TOKEN = 'kvc_0123abcd_' + 'A'.repeat(43);
const port = (s: Server) => (s.address() as AddressInfo).port;
const listen = (s: Server) =>
  new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
const close = (s: Server) => new Promise<void>((r) => s.close(() => r()));

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

describe('allow-list ingest proxy', () => {
  let upstream: Server;
  let proxy: Server;
  const seen: Seen[] = [];
  let upstreamStatus = 200;

  beforeEach(async () => {
    seen.length = 0;
    upstreamStatus = 200;
    upstream = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks),
        });
        res.writeHead(upstreamStatus, {
          'content-type': 'application/json',
          'x-from': 'api',
        });
        res.end(
          JSON.stringify({
            from: 'api',
            url: req.url,
            bytes: Buffer.concat(chunks).length,
          })
        );
      });
    });
    await listen(upstream);
    proxy = createIngestProxy({
      target: `http://127.0.0.1:${port(upstream)}`,
      maxBodyBytes: 1024 * 1024,
    });
    await listen(proxy);
  });
  afterEach(async () => {
    await close(proxy);
    await close(upstream);
  });

  const call = (
    method: string,
    path: string,
    opts: { headers?: Record<string, string>; body?: Buffer } = {}
  ) =>
    new Promise<{
      status: number;
      body: string;
      headers: IncomingMessage['headers'];
    }>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: port(proxy),
          method,
          path,
          headers: opts.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString(),
              headers: res.headers,
            })
          );
        }
      );
      req.on('error', reject);
      req.end(opts.body);
    });
  const authed = { authorization: `Bearer ${TOKEN}` };

  describe('forwards exactly the three routes a connector needs', () => {
    it('GET /api/health/live (no credentials needed)', async () => {
      const r = await call('GET', '/api/health/live');
      expect(r.status).toBe(200);
      expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
        'GET /api/health/live',
      ]);
    });

    it('GET /api/instrument-ingest/ping with a connector token', async () => {
      expect(
        (await call('GET', '/api/instrument-ingest/ping', { headers: authed }))
          .status
      ).toBe(200);
      expect(seen[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('POST /api/instrument-ingest/messages: the body and the upload headers arrive byte-for-byte, and the API answer comes back', async () => {
      const body = Buffer.from(
        Array.from({ length: 300_000 }, (_, i) => i % 256)
      );
      const r = await call('POST', '/api/instrument-ingest/messages', {
        headers: {
          ...authed,
          'content-type': 'application/octet-stream',
          'content-encoding': 'gzip',
          'x-content-sha256': 'ab'.repeat(32),
          'x-transfer-status': 'complete',
          'content-length': String(body.length),
        },
        body,
      });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toMatchObject({ from: 'api', bytes: 300_000 });
      expect(seen[0].body.equals(body)).toBe(true);
      expect(seen[0].headers).toMatchObject({
        'content-encoding': 'gzip',
        'x-content-sha256': 'ab'.repeat(32),
        'x-transfer-status': 'complete',
      });
    });

    it("relays the API's error statuses untouched (e.g. the API's own 401)", async () => {
      upstreamStatus = 401;
      expect(
        (await call('GET', '/api/instrument-ingest/ping', { headers: authed }))
          .status
      ).toBe(401);
    });
  });

  describe('everything else is a bare 404 that never reaches the API', () => {
    const blocked: Array<[string, string]> = [
      ['GET', '/api/docs'],
      ['GET', '/api/docs-json'],
      ['GET', '/api/health/ready'],
      ['GET', '/api/health/test-error'],
      ['POST', '/api/health/test-error'],
      ['GET', '/api/lab/instruments/summary'],
      ['GET', '/api/lab/instruments/messages'],
      ['GET', '/api/lab/orders'],
      ['GET', '/api/auth/me'],
      ['GET', '/api/instrument-ingest/messages'], // wrong method
      ['POST', '/api/instrument-ingest/ping'], // wrong method
      ['POST', '/api/health/live'], // wrong method
      ['PUT', '/api/instrument-ingest/messages'],
      ['DELETE', '/api/instrument-ingest/messages'],
      ['HEAD', '/api/health/live'],
      ['OPTIONS', '/api/instrument-ingest/messages'],
      ['GET', '/'],
      ['GET', '/api'],
      ['GET', '/api/'],
      // near misses of allowed routes
      ['GET', '/api/health/live/'],
      ['GET', '/api/health/live?x=1'],
      ['GET', '/api/health/live#frag'],
      ['GET', '/API/health/live'],
      ['GET', '//api/health/live'],
      ['GET', '/api/health/./live'],
      ['GET', '/api/health/../health/live'],
      ['GET', '/api/health/%6Cive'],
      ['GET', '/api/health/live%00'],
      ['GET', '/api/health/live;x'],
      ['POST', '/api/instrument-ingest/messages/'],
      ['POST', '/api/instrument-ingest/messages?x=1'],
      ['POST', '/api/instrument-ingest/messages/../../lab/instruments/summary'],
      ['POST', '/api/instrument-ingest/messages%2F..%2F..%2Flab'],
      ['GET', 'http://example.com/api/lab/instruments/summary'], // absolute-form request target
    ];
    it.each(blocked)('%s %s', async (method, path) => {
      const r = await call(method, path, { headers: authed });
      expect(r.status).toBe(404);
      if (method !== 'HEAD')
        expect(JSON.parse(r.body)).toEqual({
          statusCode: 404,
          message: 'Not Found',
        });
      expect(r.headers['x-from']).toBeUndefined();
      expect(seen).toHaveLength(0); // the API was never contacted
    });

    it('a request with a smuggled second request line in the target is not forwarded either', async () => {
      const raw = await new Promise<string>((resolve) => {
        const s = createConnection(
          { host: '127.0.0.1', port: port(proxy) },
          () =>
            s.write(
              'GET /api/health/live HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\nGET /api/lab/orders HTTP/1.1\r\nHost: x\r\n\r\n'
            )
        );
        let out = '';
        s.on('data', (d) => (out += d));
        s.on('close', () => resolve(out));
      });
      expect(raw).toMatch(/^HTTP\/1\.1 (200|400)/); // Node may reject the pipelined bytes outright; either way:
      expect(
        seen.map((x) => x.url).filter((u) => u !== '/api/health/live')
      ).toEqual([]); // the smuggled request never reached the API
    });
  });

  describe('credentials are required for the ingest routes before anything is forwarded', () => {
    it.each([
      ['no Authorization', {}],
      ['not a bearer', { authorization: 'Basic abc' }],
      [
        'a Supabase-JWT-shaped bearer',
        { authorization: 'Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.sig' },
      ],
      ['a malformed connector token', { authorization: 'Bearer kvc_short_x' }],
    ])('%s -> 401, never forwarded', async (_n, headers) => {
      for (const [m, p] of [
        ['GET', '/api/instrument-ingest/ping'],
        ['POST', '/api/instrument-ingest/messages'],
      ] as const) {
        expect((await call(m, p, { headers })).status).toBe(401);
      }
      expect(seen).toHaveLength(0);
    });
  });

  describe('limits and failure', () => {
    it('refuses an oversized upload with 413 and the API never gets the complete body', async () => {
      const r = await call('POST', '/api/instrument-ingest/messages', {
        headers: authed,
        body: Buffer.alloc(3 * 1024 * 1024, 1),
      }).catch(() => ({ status: 413 }));
      expect(r.status).toBe(413);
      expect(seen.every((s) => s.body.length < 3 * 1024 * 1024)).toBe(true);
    });

    it('answers 502 when the API is down', async () => {
      await close(upstream);
      expect((await call('GET', '/api/health/live')).status).toBe(502);
      upstream = createServer();
      await listen(upstream);
    });

    it('does not pass the caller Host header to the API', async () => {
      await call('GET', '/api/health/live', {
        headers: { host: 'evil.example.com' },
      });
      expect(seen[0].headers.host).toBe(`127.0.0.1:${port(upstream)}`);
    });
  });
});
