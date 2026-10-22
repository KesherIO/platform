import { summarizeHl7 } from './hl7-summary';
import { hl7For, loadRealCapture } from './test-helpers';
import { FrameDecoder } from './framing';

describe('summarizeHl7', () => {
  it('reads sample ID from PID-3 and the MSH fields', () => {
    expect(summarizeHl7(Buffer.from(hl7For('168', '2577')))).toEqual({
      sendingApplication: 'Genrui',
      sendingFacility: 'VH30',
      messageType: 'ORU^R01',
      controlId: '2577',
      messageTime: '20261020090403',
      version: '2.3.1',
      sampleId: '168',
      obxCount: 2,
    });
  });

  it('returns nulls for non-HL7 input instead of throwing', () => {
    expect(summarizeHl7(Buffer.from('garbage')).sampleId).toBeNull();
  });

  const real = loadRealCapture();
  (real ? it : it.skip)('summarizes the real capture: samples 168,169,168,1111,1111 with 34 OBX each', () => {
    const { frames } = new FrameDecoder().push(real!);
    const s = frames.map((f) => summarizeHl7(f.payload));
    expect(s.map((x) => x.sampleId)).toEqual(['168', '169', '168', '1111', '1111']);
    expect(s.map((x) => x.controlId)).toEqual(['2577', '2574', '2577', '2580', '2580']);
    expect(s.every((x) => x.obxCount === 34)).toBe(true);
    expect(s[0].messageTime).not.toBe(s[2].messageTime); // resend: same control ID, new timestamp
  });
});
