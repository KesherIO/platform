import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * Development-only allow-list reverse proxy that sits between a public tunnel and the local API, so the
 * tunnel exposes exactly what a connector needs and nothing else:
 *
 *   GET  /api/health/live                 reachability check
 *   GET  /api/instrument-ingest/ping      credential check
 *   POST /api/instrument-ingest/messages  the upload
 *
 * Every other path or method gets a bare 404 and is never forwarded — no Swagger, no health/ready, no
 * lab/clinic routes, no auth routes. The two ingest routes also require a connector-shaped bearer token
 * before anything is forwarded (the API still does the real authentication). Not for production use.
 */
export interface AllowedRoute {
  method: string;
  path: string;
  /** the route needs `Authorization: Bearer kvc_…` before it is forwarded */
  requiresConnectorToken: boolean;
}

export const ALLOWED_ROUTES: AllowedRoute[] = [
  { method: 'GET', path: '/api/health/live', requiresConnectorToken: false },
  { method: 'GET', path: '/api/instrument-ingest/ping', requiresConnectorToken: true },
  { method: 'POST', path: '/api/instrument-ingest/messages', requiresConnectorToken: true },
];

export interface IngestProxyOptions {
  /** e.g. http://127.0.0.1:3010 */
  target: string;
  /** hard cap on an upload body (the API caps at 16 MB decompressed; the wire size is smaller) */
  maxBodyBytes?: number;
  upstreamTimeoutMs?: number;
  routes?: AllowedRoute[];
  log?: (line: string) => void;
}

const TOKEN_HEADER = /^Bearer kvc_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

function send(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  const body = JSON.stringify({ statusCode: status, message });
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

const forwardable = (headers: IncomingHttpHeaders) =>
  Object.fromEntries(Object.entries(headers).filter(([k, v]) => v !== undefined && !HOP_BY_HOP.has(k.toLowerCase())));

export function createIngestProxy(opts: IngestProxyOptions): Server {
  const target = new URL(opts.target);
  const routes = opts.routes ?? ALLOWED_ROUTES;
  const maxBody = opts.maxBodyBytes ?? 20 * 1024 * 1024;
  const log = opts.log ?? (() => undefined);

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // Exact match on the raw request target: no query string, no fragment, no trailing slash, no dot
    // segments, no encoding tricks, no absolute-form URLs. Anything not byte-identical is "not found".
    const route = routes.find((r) => r.method === req.method && r.path === req.url);
    if (!route) {
      log(`404 ${req.method} ${String(req.url).slice(0, 80)}`);
      return send(res, 404, 'Not Found');
    }
    if (route.requiresConnectorToken && !TOKEN_HEADER.test(String(req.headers.authorization ?? ''))) {
      log(`401 ${req.method} ${req.url} (no connector token)`);
      return send(res, 401, 'Unauthorized');
    }

    let received = 0;
    let aborted = false;
    const upstream = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: { ...forwardable(req.headers), host: target.host },
        timeout: opts.upstreamTimeoutMs ?? 120_000,
      },
      (upRes) => {
        log(`${upRes.statusCode} ${req.method} ${req.url}`);
        res.writeHead(upRes.statusCode ?? 502, forwardable(upRes.headers) as Record<string, string | string[]>);
        upRes.pipe(res);
      }
    );
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
    upstream.on('error', () => {
      if (!aborted) send(res, 502, 'Bad Gateway');
    });
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBody && !aborted) {
        aborted = true;
        upstream.destroy();
        send(res, 413, 'Payload Too Large');
        req.destroy();
      }
    });
    req.pipe(upstream);
  });
}
