import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageStore } from './message-store';
import { Receiver } from './receiver';
import { FrameDecoder } from './framing';
import { hl7For, loadRealCapture, makeFrame } from './test-helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await sleep(10);
  }
}
const connect = (port: number) =>
  new Promise<Socket>((resolve, reject) => {
    const s = createConnection({ host: '127.0.0.1', port }, () => resolve(s));
    s.once('error', reject);
  });
const savedFrames = (dir: string) =>
  readdirSync(join(dir, 'inbox'), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.frame'))
    .sort()
    .map((f) => readFileSync(join(dir, 'inbox', f)));

describe('Receiver', () => {
  let dir: string;
  let receiver: Receiver;
  let sockets: Socket[];
  const errors: Error[] = [];

  const start = async (
    allowFrom?: string[],
    ack?: 'length-mllp' | 'mllp',
    store = new MessageStore(dir)
  ) => {
    receiver = new Receiver({
      host: '127.0.0.1',
      port: 0,
      store,
      allowFrom,
      ack,
    });
    receiver.on('error', (e) => errors.push(e));
    await receiver.start();
    return receiver.address().port;
  };
  const open = async (port: number) => {
    const s = await connect(port);
    sockets.push(s);
    return s;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vh30-rx-'));
    sockets = [];
    errors.length = 0;
  });
  afterEach(async () => {
    sockets.forEach((s) => s.destroy());
    await receiver.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves fragmented and back-to-back messages exactly, across reconnects, and tracks status', async () => {
    const port = await start();
    const frames = [
      makeFrame(hl7For('168', '2577')),
      makeFrame(hl7For('169', '2574')),
      makeFrame(hl7For('1111', '2580')),
    ];

    const s1 = await open(port);
    await until(() => receiver.status.connections.length === 1);
    const both = Buffer.concat([frames[0], frames[1]]);
    s1.write(both.subarray(0, 7)); // fragmented
    await sleep(20);
    s1.write(both.subarray(7)); // rest of #1 + all of #2 in one write
    await until(() => receiver.status.savedCount === 2);
    s1.destroy();
    await until(() => receiver.status.connections.length === 0);

    const s2 = await open(port); // analyzer reconnects
    s2.write(frames[2]);
    await until(() => receiver.status.savedCount === 3);

    expect(savedFrames(dir).map((b) => b.toString('hex'))).toEqual(
      frames.map((b) => b.toString('hex'))
    );
    expect(receiver.status.lastSampleId).toBe('1111');
    expect(receiver.status.lastControlId).toBe('2580');
    expect(receiver.status.errorCount).toBe(0);
  });

  it('keeps a message that was cut mid-frame under incomplete/, marks it INCOMPLETE and keeps working', async () => {
    const port = await start();
    const frame = makeFrame(hl7For('168', '2577'));
    const s1 = await open(port);
    s1.write(frame.subarray(0, 50));
    await sleep(30);
    s1.destroy();
    await until(() => receiver.status.errorCount === 1);
    const kept = readdirSync(join(dir, 'incomplete')).filter((f) =>
      f.endsWith('.bin')
    );
    expect(
      readFileSync(join(dir, 'incomplete', kept[0])).equals(
        frame.subarray(0, 50)
      )
    ).toBe(true);
    expect(receiver.status.incompleteCount).toBe(1);
    expect(receiver.status.savedCount).toBe(0); // never counted as a message

    const s2 = await open(port);
    s2.write(frame);
    await until(() => receiver.status.savedCount === 1);
    expect(receiver.status.lastError).toMatch(/INCOMPLETE transfer.*mid-frame/);
  });

  it('rejects senders not in the allow-list', async () => {
    const port = await start(['192.168.5.14']);
    const s = await open(port);
    s.on('error', () => undefined);
    s.write(makeFrame(hl7For('168', '2577')));
    await sleep(100);
    expect(receiver.status.savedCount).toBe(0);
  });

  describe('ACK', () => {
    const collectReply = (s: Socket) => {
      const got: Buffer[] = [];
      s.on('data', (c) => got.push(c));
      return () => Buffer.concat(got);
    };

    it('is off by default: nothing is written back', async () => {
      const port = await start();
      const s = await open(port);
      const reply = collectReply(s);
      s.write(makeFrame(hl7For('168', '2577')));
      await until(() => receiver.status.savedCount === 1);
      await sleep(50);
      expect(reply()).toHaveLength(0);
    });

    it('sends AA with the same control ID after the message is saved (length-mllp)', async () => {
      const port = await start(undefined, 'length-mllp');
      const s = await open(port);
      const reply = collectReply(s);
      s.write(makeFrame(hl7For('168', '2577')));
      await until(() => reply().length > 0);
      const { frames } = new FrameDecoder().push(reply());
      expect(frames[0].payload.toString()).toContain('MSA|AA|2577||||');
      expect(receiver.status.savedCount).toBe(1); // saved before/with the ACK
      expect(receiver.status.ackedCount).toBe(1);
    });

    it('ACKs a resend of the same control ID again, and every message of a burst', async () => {
      const port = await start(undefined, 'mllp');
      const s = await open(port);
      const reply = collectReply(s);
      const f = makeFrame(hl7For('168', '2577'));
      s.write(Buffer.concat([f, f, makeFrame(hl7For('169', '2574'))]));
      await until(
        () =>
          (
            reply()
              .toString('latin1')
              .match(/MSA\|AA\|/g) ?? []
          ).length === 3
      );
      expect(receiver.status.ackedCount).toBe(3);
      expect(
        reply()
          .toString('latin1')
          .match(/MSA\|AA\|(\d+)/g)
      ).toEqual(['MSA|AA|2577', 'MSA|AA|2577', 'MSA|AA|2574']);
    });

    it('does NOT ACK when the stored copy fails the read-back check', async () => {
      const store = new MessageStore(dir, {
        readBack: () => Buffer.from('corrupt'),
      });
      const port = await start(undefined, 'length-mllp', store);
      const s = await open(port);
      const reply = collectReply(s);
      s.write(makeFrame(hl7For('168', '2577')));
      await until(() => receiver.status.errorCount === 1);
      await sleep(50);
      expect(reply()).toHaveLength(0);
      expect(receiver.status.savedCount).toBe(0);
      expect(receiver.status.ackedCount).toBe(0);
    });

    it('does NOT ACK when the message could not be saved', async () => {
      const store = new MessageStore(dir);
      vi.spyOn(store, 'saveFrame').mockImplementation(() => {
        throw new Error('disk full');
      });
      const port = await start(undefined, 'length-mllp', store);
      const s = await open(port);
      const reply = collectReply(s);
      s.write(makeFrame(hl7For('168', '2577')));
      await until(() => receiver.status.errorCount === 1);
      await sleep(50);
      expect(reply()).toHaveLength(0);
      expect(receiver.status.lastError).toMatch(/disk full/);
    });
  });

  const real = loadRealCapture();
  (real ? it : it.skip)(
    'stores the real 3.4 MB capture exactly when sent in random fragments',
    async () => {
      const port = await start();
      const s = await open(port);
      for (let off = 0; off < real!.length; ) {
        const n = 1 + Math.floor(Math.random() * 20_000);
        s.write(real!.subarray(off, off + n));
        off += n;
      }
      await until(() => receiver.status.savedCount === 5, 10_000);
      expect(errors).toEqual([]);
      expect(Buffer.concat(savedFrames(dir)).equals(real!)).toBe(true);
      expect(new FrameDecoder().push(real!).frames).toHaveLength(5);
    }
  );
});
