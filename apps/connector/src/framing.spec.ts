import { FrameDecoder } from './framing';
import { hl7For, loadRealCapture, makeFrame } from './test-helpers';

const collect = (decoder: FrameDecoder, chunks: Buffer[]) => {
  const frames: Buffer[] = [];
  const issues: ReturnType<FrameDecoder['push']>['issues'] = [];
  for (const c of chunks) {
    const r = decoder.push(c);
    frames.push(...r.frames.map((f) => f.bytes));
    issues.push(...r.issues);
  }
  return { frames, issues };
};

describe('FrameDecoder', () => {
  const a = makeFrame(hl7For('168', '2577'));
  const b = makeFrame(hl7For('169', '2574'));

  it('decodes one frame and exposes the exact bytes and HL7 payload', () => {
    const { frames } = collect(new FrameDecoder(), [a]);
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(a)).toBe(true);
    const r = new FrameDecoder().push(a);
    expect(r.frames[0].payload.toString('latin1').startsWith('MSH|')).toBe(true);
  });

  it('handles every fragmentation: byte-by-byte', () => {
    const bytes = Buffer.concat([a, b]);
    const chunks = Array.from(bytes, (_, i) => bytes.subarray(i, i + 1));
    const { frames, issues } = collect(new FrameDecoder(), chunks);
    expect(issues).toEqual([]);
    expect(frames.map((f) => f.toString('hex'))).toEqual([a.toString('hex'), b.toString('hex')]);
  });

  it('handles random fragmentation and several frames per read', () => {
    const bytes = Buffer.concat([a, b, a, b, a]);
    for (let seed = 0; seed < 50; seed++) {
      const chunks: Buffer[] = [];
      for (let off = 0; off < bytes.length; ) {
        const n = 1 + Math.floor(Math.random() * 300);
        chunks.push(bytes.subarray(off, off + n));
        off += n;
      }
      const { frames, issues } = collect(new FrameDecoder(), chunks);
      expect(issues).toEqual([]);
      expect(Buffer.concat(frames).equals(bytes)).toBe(true);
      expect(frames).toHaveLength(5);
    }
  });

  it('splits the header across reads', () => {
    const { frames } = collect(new FrameDecoder(), [a.subarray(0, 2), a.subarray(2, 5), a.subarray(5)]);
    expect(frames).toHaveLength(1);
  });

  it('resyncs after garbage and keeps the garbage', () => {
    const garbage = Buffer.from('not a frame at all');
    const { frames, issues } = collect(new FrameDecoder(), [Buffer.concat([garbage, a, b])]);
    expect(frames).toHaveLength(2);
    expect(issues).toHaveLength(1);
    expect(issues[0].reason).toBe('invalid-header');
    expect(issues[0].discarded.equals(garbage)).toBe(true);
  });

  it('never loops on an oversize length followed by a valid frame', () => {
    const bad = Buffer.from(a);
    bad.writeUInt32BE(0xffffffff, 0);
    const { frames, issues } = collect(new FrameDecoder(1024 * 1024), [Buffer.concat([bad, b])]);
    expect(frames.some((f) => f.equals(b))).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('reports a frame with a bad trailer without losing the next one', () => {
    const broken = Buffer.from(a);
    broken[broken.length - 2] = 0x00;
    const { frames, issues } = collect(new FrameDecoder(), [Buffer.concat([broken, b])]);
    expect(issues.map((i) => i.reason)).toEqual(['invalid-trailer']);
    expect(issues[0].discarded.equals(broken)).toBe(true);
    expect(frames).toHaveLength(1);
    expect(frames[0].equals(b)).toBe(true);
  });

  it('flush returns an incomplete frame on disconnect', () => {
    const d = new FrameDecoder();
    d.push(a.subarray(0, 100));
    const issue = d.flush();
    expect(issue?.reason).toBe('trailing-partial');
    expect(issue?.discarded.equals(a.subarray(0, 100))).toBe(true);
    expect(d.flush()).toBeNull();
  });

  const real = loadRealCapture();
  (real ? it : it.skip)('reproduces the real VH-30 capture byte for byte (5 frames, no issues)', () => {
    const decoder = new FrameDecoder();
    const chunks: Buffer[] = [];
    for (let off = 0; off < real!.length; off += 1460) chunks.push(real!.subarray(off, off + 1460));
    const { frames, issues } = collect(decoder, chunks);
    expect(issues).toEqual([]);
    expect(decoder.flush()).toBeNull();
    expect(frames).toHaveLength(5);
    expect(Buffer.concat(frames).equals(real!)).toBe(true);
  });
});
