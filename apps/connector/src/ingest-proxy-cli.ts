import { parseArgs } from 'node:util';
import { ALLOWED_ROUTES, createIngestProxy } from './ingest-proxy';

const { values } = parseArgs({
  options: {
    'listen-port': { type: 'string', default: '3011' },
    target: { type: 'string', default: 'http://127.0.0.1:3010' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    `Dev-only allow-list proxy for a public tunnel.\n  --listen-port <n>  (default 3011, binds 127.0.0.1 only)\n  --target <url>     the local API (default http://127.0.0.1:3010)\nForwards only:\n${ALLOWED_ROUTES.map(
      (r) => `  ${r.method} ${r.path}`
    ).join('\n')}`
  );
  process.exit(0);
}
const port = Number(values['listen-port']);
const target = String(values.target);
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(target)) {
  console.error(
    'Refusing: --target must be a local http address (this proxy is for the local dev API only).'
  );
  process.exit(1);
}
createIngestProxy({
  target,
  log: (l) => console.log(`[${new Date().toLocaleTimeString()}] ${l}`),
}).listen(port, '127.0.0.1', () => {
  console.log(
    `Allow-list proxy on 127.0.0.1:${port} -> ${target}; forwarding only: ${ALLOWED_ROUTES.map(
      (r) => `${r.method} ${r.path}`
    ).join(', ')}`
  );
});
