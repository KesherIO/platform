import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { AckFraming } from './ack';
import { configPath, loadConfig, saveConfig, validateConfig } from './config';
import { MessageStore } from './message-store';
import { Receiver } from './receiver';
import { formatStatus, uploadTransition } from './status-format';
import { Uploader, type UploaderStatus } from './uploader';

const HELP = `VH-30 receiver - listens for the analyzer and saves every message locally.

  --host <addr>        address to listen on        (default 0.0.0.0, env VH30_HOST)
  --port <n>           TCP port                    (default 8001,    env VH30_PORT)
  --data-dir <dir>     where messages are saved    (default ./data,  env VH30_DATA_DIR)
  --allow-from <ip>    only accept this analyzer IP; repeatable (env VH30_ALLOW_FROM, comma list)
  --ack <mode>         off | length-mllp | mllp   (default off, env VH30_ACK). UNTESTED on device:
                       turn on only together with ACK Synchronous Transmission on the analyzer
  --configure          save the API address + token to <data-dir>/connector.json, then exit
  --api-url <url>      with --configure (or env VH30_API_URL)
  --token <token>      with --configure (or env VH30_API_TOKEN)
  --help
`;

const log = (msg: string) =>
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      'data-dir': { type: 'string' },
      'allow-from': { type: 'string', multiple: true },
      ack: { type: 'string' },
      configure: { type: 'boolean' },
      'api-url': { type: 'string' },
      token: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return void console.log(HELP);

  const host = values.host ?? process.env.VH30_HOST ?? '0.0.0.0';
  const port = Number(values.port ?? process.env.VH30_PORT ?? 8001);
  const dataDir = resolve(
    values['data-dir'] ?? process.env.VH30_DATA_DIR ?? './data'
  );
  const allowFrom = (
    values['allow-from'] ??
    process.env.VH30_ALLOW_FROM?.split(',') ??
    []
  )
    .map((s) => s.trim())
    .filter(Boolean);
  const ackMode = values.ack ?? process.env.VH30_ACK ?? 'off';
  if (!['off', 'length-mllp', 'mllp'].includes(ackMode))
    throw new Error(`Invalid --ack: ${ackMode}`);
  const ack = ackMode === 'off' ? null : (ackMode as AckFraming);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`Invalid port: ${port}`);

  if (values.configure) {
    const config = validateConfig({
      apiUrl: values['api-url'],
      token: values.token,
    });
    mkdirSync(dataDir, { recursive: true });
    saveConfig(dataDir, config);
    return void console.log(
      `Saved ${configPath(dataDir)}\nUploads will go to ${config.apiUrl}`
    );
  }

  const store = new MessageStore(dataDir);
  const config = loadConfig(dataDir);
  const uploader = config ? new Uploader({ store, ...config }) : null;
  const receiver = new Receiver({ host, port, store, allowFrom, ack });

  receiver.on('connected', (c) => log(`Analyzer connected from ${c.remote}`));
  receiver.on('disconnected', (c) =>
    log(`Analyzer disconnected (${c.remote}, ${c.bytes} bytes received)`)
  );
  receiver.on('rejected', (ip) =>
    log(`Rejected connection from ${ip} (not in --allow-from)`)
  );
  receiver.on('message', (m) => {
    log(
      `Saved sample ${m.hl7.sampleId ?? '?'} control ${
        m.hl7.controlId ?? '?'
      } (${m.bytes} bytes) -> ${m.id}`
    );
    uploader?.kick();
  });
  receiver.on('incomplete', ({ meta }) => {
    log(
      `INCOMPLETE transfer kept (${meta.reason}, ${meta.bytes} bytes) -> ${meta.id}. It is NOT a result.`
    );
    uploader?.kick();
  });
  uploader?.on('uploaded', (u) =>
    log(
      `Uploaded ${u.complete ? 'message' : 'INCOMPLETE transfer'} -> ${
        u.status
      }${u.duplicateUpload ? ' (server already had it)' : ''}`
    )
  );
  uploader?.on('rejected', (r) =>
    log(
      `ERROR: the server rejected ${r.id} permanently (${r.error}); kept locally`
    )
  );
  let lastUpload: UploaderStatus | null = null;
  uploader?.on('status', (u) => {
    writeStatusFile(dataDir, { ...receiver.status, upload: u });
    const note = uploadTransition(lastUpload, u);
    lastUpload = u;
    if (note) {
      log(note);
      console.log(formatStatus(receiver.status, u));
    }
  });
  receiver.on('acked', (a) =>
    log(`ACK sent for control ${a.controlId} (${ackMode})`)
  );
  receiver.on('error', (e) => log(`ERROR: ${e.message}`));
  receiver.on('status', (s) => {
    writeStatusFile(dataDir, { ...s, upload: uploader?.status ?? null });
    if (!quietUntilListening)
      console.log(formatStatus(s, uploader?.status ?? null));
  });

  let quietUntilListening = true;
  await receiver.start();
  quietUntilListening = false;
  log(
    `Listening on ${host}:${receiver.address().port}${
      allowFrom.length ? `, only from ${allowFrom.join(', ')}` : ' (any sender)'
    }`
  );
  log(`Saving to ${dataDir}; ACK: ${ackMode}`);
  log(
    uploader
      ? `Uploading to ${config?.apiUrl}`
      : 'Upload is OFF (capture only). Run with --configure to set the API address and token.'
  );
  uploader?.start();
  console.log(formatStatus(receiver.status, uploader?.status ?? null));

  const shutdown = () => {
    uploader?.stop();
    void receiver.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function writeStatusFile(dataDir: string, status: unknown): void {
  try {
    const target = join(dataDir, 'status.json');
    writeFileSync(`${target}.tmp`, JSON.stringify(status, null, 2));
    renameSync(`${target}.tmp`, target);
  } catch {
    /* status file is informational only */
  }
}

main().catch((err: NodeJS.ErrnoException) => {
  const hint =
    err.code === 'EADDRINUSE'
      ? ' - another program (or a second copy of this one) is already using that port.'
      : err.code === 'EADDRNOTAVAIL'
      ? ' - that IP is not assigned to this computer. Check the USB Ethernet adapter is plugged in and set to 192.168.5.13.'
      : '';
  console.error(`Could not start: ${err.message}${hint}`);
  process.exit(1);
});
