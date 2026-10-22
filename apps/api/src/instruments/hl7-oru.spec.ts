import { contentHash, decodeFrame, diffSummaries, InvalidFrameError, parseHl7Time, parseOru, peekHeader, toStoredSummary } from './hl7-oru';
import { hasCapture, makeFrame, realFrames, rewriteFrame, sampleHl7 } from './test-frames';

const parse = (hl7: string) => {
  const payload = decodeFrame(makeFrame(hl7));
  return { oru: parseOru(payload), payload };
};

describe('hl7-oru', () => {
  describe('decodeFrame', () => {
    it('returns the HL7 between 0x0B and 0x1C 0x0D', () => {
      expect(decodeFrame(makeFrame('MSH|x\r')).toString()).toBe('MSH|x\r');
    });
    it.each([
      ['wrong length prefix', (f: Buffer) => { const c = Buffer.from(f); c.writeUInt32BE(5, 0); return c; }],
      ['missing 0x0B', (f: Buffer) => { const c = Buffer.from(f); c[4] = 0x41; return c; }],
      ['missing trailer', (f: Buffer) => { const c = Buffer.from(f); c[c.length - 2] = 0; return c; }],
      ['too short', () => Buffer.from([0, 0, 0, 1, 0x0b])],
    ])('rejects %s', (_n, mutate) => {
      expect(() => decodeFrame(mutate(makeFrame(sampleHl7())))).toThrow(InvalidFrameError);
    });
  });

  describe('parseOru', () => {
    it('reads header, sample ID, observation time and parameters', () => {
      const { oru } = parse(sampleHl7());
      expect(oru).toMatchObject({
        controlId: '2577',
        messageTime: '20261020090403',
        version: '2.3.1',
        sendingApplication: 'Genrui',
        sendingFacility: 'VH30',
        observationTimeRaw: '20261019191457',
        patient: { sampleId: '168', speciesText: 'dog', sex: 'O' },
      });
      const wbc = oru.observations[0];
      expect(wbc).toMatchObject({ code: 'WBC', value: '13.23', unit: '10^9/L', referenceRange: '6.00-17.00', userFlag: '' });
    });
    it('keeps a literal LF inside a value (alarm lists) — segments split on CR only', () => {
      const { oru } = parse(sampleHl7());
      expect(oru.observations.find((o) => o.code === 'WBC Alarm')?.value).toBe('Leucocytosis\nLinfocitosis');
    });
    it('flags images and reads OBX-13', () => {
      const { oru } = parse(sampleHl7({ flag: 'O' }));
      expect(oru.observations.find((o) => o.isImage)?.code).toBe('WBCHistogram_BMP');
      expect(oru.observations[0].userFlag).toBe('O');
    });
    it('refuses anything but ORU^R01', () => {
      expect(() => parseOru(Buffer.from('MSH|^~\\&|a|b|||1||ACK^R01|1|P|2.3.1\r'))).toThrow(/Unsupported message type/);
      expect(() => parseOru(Buffer.from('PID|1\r'))).toThrow(/No MSH/);
    });
  });

  describe('contentHash', () => {
    const hash = (hl7: string) => { const { oru, payload } = parse(hl7); return contentHash(oru, payload); };
    it('is unchanged by a resend: new MSH-7 and MSH-10 only', () => {
      expect(hash(sampleHl7({ time: '20261021101010', controlId: '9999' }))).toBe(hash(sampleHl7()));
    });
    it.each([
      ['a value', sampleHl7({ wbc: '14.00' })],
      ['an OBX-13 flag', sampleHl7({ flag: 'E' })],
      ['the sample ID', sampleHl7({ sampleId: '169' })],
      ['the observation time', sampleHl7({ obs: '20261019191458' })],
    ])('changes when %s changes', (_n, edited) => {
      expect(hash(edited)).not.toBe(hash(sampleHl7()));
    });
    it('changes when only a histogram changes', () => {
      expect(hash(sampleHl7().replace('516b32', '516b33'))).not.toBe(hash(sampleHl7()));
    });
  });

  describe('diffSummaries', () => {
    const summary = (hl7: string) => { const { oru, payload } = parse(hl7); return toStoredSummary(oru, payload); };
    it('lists changed values and flags, with before and after', () => {
      const d = diffSummaries(summary(sampleHl7()), summary(sampleHl7({ wbc: '14.00', flag: 'E' })));
      expect(d.changed).toHaveLength(1);
      expect(d.changed[0]).toMatchObject({ code: 'WBC', before: { value: '13.23', userFlag: '' }, after: { value: '14.00', userFlag: 'E' } });
      expect(d.added).toEqual([]);
      expect(d.imagesChanged).toEqual([]);
    });
    it('reports a histogram-only change', () => {
      const d = diffSummaries(summary(sampleHl7()), summary(sampleHl7().replace('516b32', '516b33')));
      expect(d.changed).toEqual([]);
      expect(d.imagesChanged).toEqual(['WBCHistogram_BMP']);
    });
    it('does not keep image data in the stored summary', () => {
      expect(JSON.stringify(summary(sampleHl7()))).not.toContain('516b32');
    });
  });

  describe('parseHl7Time', () => {
    it('converts the analyzer wall clock using the lab time zone', () => {
      expect(parseHl7Time('20261019191457', 'America/Bogota')?.toISOString()).toBe('2026-10-20T00:14:57.000Z');
      expect(parseHl7Time('20261019191457', 'UTC')?.toISOString()).toBe('2026-10-19T19:14:57.000Z');
    });
    it('handles DST zones and falls back to UTC for an unknown zone', () => {
      expect(parseHl7Time('20260715120000', 'America/New_York')?.toISOString()).toBe('2026-07-15T16:00:00.000Z');
      expect(parseHl7Time('20260115120000', 'America/New_York')?.toISOString()).toBe('2026-01-15T17:00:00.000Z');
      expect(parseHl7Time('20261019191457', 'Not/AZone')?.toISOString()).toBe('2026-10-19T19:14:57.000Z');
    });
    it('returns null for junk', () => {
      expect(parseHl7Time(null)).toBeNull();
      expect(parseHl7Time('abc')).toBeNull();
    });
  });

  describe('peekHeader', () => {
    it('reads what it can from a truncated message', () => {
      const frame = makeFrame(sampleHl7());
      expect(peekHeader(frame.subarray(0, 86))).toEqual({ controlId: '2577', sampleId: null, messageTime: '20261020090403' });
      expect(peekHeader(frame.subarray(0, 140)).sampleId).toBe('168');
    });
    it('returns nulls for garbage', () => {
      expect(peekHeader(Buffer.from('zzzz'))).toEqual({ controlId: null, sampleId: null, messageTime: null });
    });
  });

  (hasCapture ? describe : describe.skip)('real VH-30 capture', () => {
    it('parses all 5 frames: sample IDs, control IDs, 31 numeric+text OBX and 3 images', () => {
      const parsed = realFrames().map((f) => { const p = decodeFrame(f); return { oru: parseOru(p), payload: p }; });
      expect(parsed.map((p) => p.oru.patient.sampleId)).toEqual(['168', '169', '168', '1111', '1111']);
      expect(parsed.map((p) => p.oru.controlId)).toEqual(['2577', '2574', '2577', '2580', '2580']);
      for (const p of parsed) {
        expect(p.oru.observations.filter((o) => !o.isImage)).toHaveLength(31);
        expect(p.oru.observations.filter((o) => o.isImage).map((o) => o.code)).toEqual(['WBCHistogram_BMP', 'RBCHistogram_BMP', 'PLTHistogram_BMP']);
      }
      expect(parsed[3].oru.observations.find((o) => o.code === 'HGB')).toMatchObject({ value: '5.7', unit: 'g/dL' });
    });
    it('resends hash equal (different MSH-7), different samples do not', () => {
      const h = realFrames().map((f) => { const p = decodeFrame(f); return contentHash(parseOru(p), p); });
      expect(parseOru(decodeFrame(realFrames()[0])).messageTime).not.toBe(parseOru(decodeFrame(realFrames()[2])).messageTime);
      expect(h[0]).toBe(h[2]);
      expect(h[3]).toBe(h[4]);
      expect(new Set(h).size).toBe(3);
    });
    it('rewriteFrame keeps a valid frame', () => {
      const edited = rewriteFrame(realFrames()[3], (t) => t.replace('71.36', '65.10'));
      expect(parseOru(decodeFrame(edited)).observations[0].value).toBe('65.10');
    });
  });
});
