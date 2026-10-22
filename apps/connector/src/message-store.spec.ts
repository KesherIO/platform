import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageStore } from './message-store';
import { summarizeHl7 } from './hl7-summary';
import { hl7For, makeFrame } from './test-helpers';

describe('MessageStore', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'vh30-store-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const ctx = { remoteAddress: '192.168.5.14', remotePort: 5000 };

  it('writes the frame byte-for-byte plus a metadata sidecar, and counts', () => {
    const frame = makeFrame(hl7For('168', '2577'));
    const store = new MessageStore(dir);
    const meta = store.saveFrame(
      frame,
      summarizeHl7(frame.subarray(5, -2)),
      ctx
    );

    const day = readdirSync(join(dir, 'inbox'))[0];
    const saved = readFileSync(join(dir, 'inbox', day, meta.frameFile));
    expect(saved.equals(frame)).toBe(true);
    expect(meta.hl7.sampleId).toBe('168');
    expect(meta.sha256).toHaveLength(64);
    expect(store.savedCount).toBe(1);
    expect(
      readdirSync(join(dir, 'inbox', day)).some((f) => f.endsWith('.tmp'))
    ).toBe(false);
  });

  it('keeps identical resends as separate files', () => {
    const frame = makeFrame(hl7For('168', '2577'));
    const store = new MessageStore(dir);
    const now = new Date('2026-10-20T09:04:03.000Z');
    const a = store.saveFrame(frame, summarizeHl7(frame), ctx, now);
    const b = store.saveFrame(frame, summarizeHl7(frame), ctx, now);
    expect(a.id).not.toBe(b.id);
    expect(store.savedCount).toBe(2);
  });

  it('restores the count after a restart', () => {
    const frame = makeFrame(hl7For('168', '2577'));
    const first = new MessageStore(dir);
    first.saveFrame(frame, summarizeHl7(frame), ctx);
    first.saveFrame(frame, summarizeHl7(frame), ctx);
    expect(new MessageStore(dir).savedCount).toBe(2);
  });

  it('saves interrupted bytes under incomplete/ with a complete:false sidecar, never counted as messages', () => {
    const store = new MessageStore(dir);
    const meta = store.saveIncomplete(
      Buffer.from([1, 2, 3]),
      'trailing-partial',
      ctx
    );
    expect(
      readFileSync(join(dir, 'incomplete', meta.dataFile)).equals(
        Buffer.from([1, 2, 3])
      )
    ).toBe(true);
    const side = JSON.parse(
      readFileSync(
        join(dir, 'incomplete', meta.dataFile.replace('.bin', '.json')),
        'utf8'
      )
    );
    expect(side).toMatchObject({
      complete: false,
      reason: 'trailing-partial',
      bytes: 3,
      remoteAddress: '192.168.5.14',
    });
    expect(store.savedCount).toBe(0);
    expect(store.incompleteCount).toBe(1);
    expect(new MessageStore(dir).incompleteCount).toBe(1); // survives a restart
  });

  describe('durability check before a message counts as saved (the ACK depends on it)', () => {
    const frame = makeFrame(hl7For('168', '2577'));

    it('throws, counts nothing and leaves no file when the read-back does not match', () => {
      const store = new MessageStore(dir, {
        readBack: (p) =>
          Buffer.concat([readFileSync(p).subarray(0, 10), Buffer.from('X')]),
      });
      expect(() => store.saveFrame(frame, summarizeHl7(frame), ctx)).toThrow(
        /read-back/
      );
      expect(store.savedCount).toBe(0);
      expect(new MessageStore(dir).savedCount).toBe(0);
      const day = readdirSync(join(dir, 'inbox'))[0];
      expect(readdirSync(join(dir, 'inbox', day))).toEqual([]);
    });

    it('reads the file back from disk and compares it before returning', () => {
      const readBack = vi.fn((p: string) => readFileSync(p));
      const store = new MessageStore(dir, { readBack });
      const meta = store.saveFrame(frame, summarizeHl7(frame), ctx);
      expect(readBack).toHaveBeenCalledTimes(1);
      expect(readBack.mock.calls[0][0]).toMatch(/\.frame$/);
      expect(meta.complete).toBe(true);
    });
  });
});
