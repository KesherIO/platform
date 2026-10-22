import { readFileSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { parseArgs } from 'node:util';
import { FrameDecoder } from './framing';

const HELP = `Replay a captured VH-30 stream to a receiver, like the analyzer would.

  vh30-replay <capture-file> [options]
  --host <addr>          receiver address            (default 127.0.0.1)
  --port <n>             receiver port               (default 8001)
  --chunk <bytes>        write size                  (default 1460)
  --random-chunks        random write sizes 1..chunk (exercises fragmentation)
  --chunk-delay-ms <n>   pause between writes        (default 0)
  --new-connection       open a fresh connection per message
  --repeat <n>           send the whole capture n times (default 1)
  --frames <n>           only send the first n messages
  --cut-mid-frame        send half of the last message, then disconnect
  --expect-ack           act like an analyzer with ACK enabled: after each message wait for
                         an MSA|AA|<control ID> reply; resend if none arrives
  --ack-timeout-ms <n>   how long to wait for the ACK (default 3000, per the protocol PDF)
  --max-resends <n>      resends before giving up (default 3)
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '8001' },
      chunk: { type: 'string', default: '1460' },
      'random-chunks': { type: 'boolean' },
      'chunk-delay-ms': { type: 'string', default: '0' },
      'new-connection': { type: 'boolean' },
      repeat: { type: 'string', default: '1' },
      frames: { type: 'string' },
      'cut-mid-frame': { type: 'boolean' },
      'expect-ack': { type: 'boolean' },
      'ack-timeout-ms': { type: 'string', default: '3000' },
      'max-resends': { type: 'string', default: '3' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || positionals.length !== 1) return void console.log(HELP);

  const capture = readFileSync(positionals[0]);
  const decoder = new FrameDecoder();
  const { frames, issues } = decoder.push(capture);
  if (issues.length || decoder.flush())
    throw new Error('Capture file is not a clean sequence of VH-30 frames');
  const limit = values.frames ? Number(values.frames) : frames.length;
  const toSend = frames.slice(0, limit).map((f) => f.bytes);
  console.log(
    `Capture: ${capture.length} bytes, ${frames.length} message(s); sending ${toSend.length}`
  );

  const chunk = Number(values.chunk);
  const delay = Number(values['chunk-delay-ms']);
  const random = !!values['random-chunks'];
  const connect = () =>
    new Promise<Socket>((resolve, reject) => {
      const s = createConnection(
        { host: values.host, port: Number(values.port) },
        () => resolve(s)
      );
      s.once('error', reject);
    });
  const ackTimeout = Number(values['ack-timeout-ms']);
  const maxResends = Number(values['max-resends']);
  const controlIdOf = (frame: Buffer) =>
    /ORU\^R01\|([^|]*)\|/.exec(frame.toString('latin1', 0, 400))?.[1] ?? null;

  /** Accumulates replies; resolves once an AA for `id` arrives, or false on timeout. */
  const replies = new WeakMap<Socket, { text: string }>();
  const watch = (s: Socket) => {
    const state = { text: '' };
    replies.set(s, state);
    s.on('data', (c) => (state.text += c.toString('latin1')));
  };
  const waitForAck = async (s: Socket, id: string) => {
    const end = Date.now() + ackTimeout;
    while (Date.now() < end) {
      const text = replies.get(s)?.text ?? '';
      const m = new RegExp(`MSA\\|(A[AER])\\|${id}\\|`).exec(text);
      if (m) return m[1];
      await sleep(10);
    }
    return null;
  };
  const sendWithAck = async (s: Socket, frame: Buffer, label: string) => {
    const id = controlIdOf(frame);
    if (!id) throw new Error(`${label}: cannot read control ID`);
    for (let attempt = 0; attempt <= maxResends; attempt++) {
      replies.get(s)!.text = '';
      await write(s, frame);
      const code = await waitForAck(s, id);
      if (code)
        return console.log(
          `${label}: ACK ${code} for control ID ${id}${
            attempt ? ` after ${attempt} resend(s)` : ''
          }`
        );
      console.log(`${label}: no ACK within ${ackTimeout} ms, resending`);
    }
    throw new Error(`${label}: no ACK after ${maxResends} resends`);
  };

  const close = (s: Socket) => new Promise<void>((r) => s.end(() => r()));

  const write = async (s: Socket, bytes: Buffer) => {
    for (let off = 0; off < bytes.length; ) {
      const size = random ? 1 + Math.floor(Math.random() * chunk) : chunk;
      const piece = bytes.subarray(off, off + size);
      if (!s.write(piece)) await new Promise((r) => s.once('drain', r));
      off += piece.length;
      if (delay) await sleep(delay);
    }
  };

  for (let round = 1; round <= Number(values.repeat); round++) {
    let socket = await connect();
    if (values['expect-ack']) watch(socket);
    for (let i = 0; i < toSend.length; i++) {
      const isLast = i === toSend.length - 1;
      if (isLast && values['cut-mid-frame']) {
        await write(
          socket,
          toSend[i].subarray(0, Math.floor(toSend[i].length / 2))
        );
        socket.destroy();
        console.log(`round ${round}: message ${i + 1} cut mid-frame`);
        break;
      }
      if (values['expect-ack'])
        await sendWithAck(
          socket,
          toSend[i],
          `round ${round}: message ${i + 1}/${toSend.length}`
        );
      else {
        await write(socket, toSend[i]);
        console.log(
          `round ${round}: sent message ${i + 1}/${toSend.length} (${
            toSend[i].length
          } bytes)`
        );
      }
      if (values['new-connection'] && !isLast) {
        await close(socket);
        socket = await connect();
        if (values['expect-ack']) watch(socket);
      }
    }
    if (!socket.destroyed) await close(socket);
  }
}

main().catch((err: Error) => {
  console.error(`Replay failed: ${err.message}`);
  process.exit(1);
});
