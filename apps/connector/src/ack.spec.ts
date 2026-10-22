import { buildAckFrame, buildAckPayload } from './ack';
import { FrameDecoder } from './framing';
import { summarizeHl7 } from './hl7-summary';
import { hl7For } from './test-helpers';

const oru = summarizeHl7(Buffer.from(hl7For('168', '2577')));

describe('ACK^R01', () => {
  it('echoes the control ID in MSA-2 and swaps sender/receiver', () => {
    const lines = buildAckPayload(
      oru,
      'AA',
      new Date(2026, 9, 20, 9, 4, 3)
    )!.split('\r');
    expect(lines[0]).toBe(
      'MSH|^~\\&|KesherIO|Connector|Genrui|VH30|20261020090403||ACK^R01|2577|P|2.3.1'
    );
    expect(lines[1]).toBe('MSA|AA|2577||||');
    expect(lines[2]).toBe(''); // segments end with CR
  });

  it('length-mllp framing decodes with the same decoder as inbound frames', () => {
    const { frames, issues } = new FrameDecoder().push(
      buildAckFrame(oru, 'length-mllp')!
    );
    expect(issues).toEqual([]);
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.toString()).toContain('MSA|AA|2577||||');
  });

  it('plain mllp framing has no length prefix', () => {
    const frame = buildAckFrame(oru, 'mllp')!;
    expect(frame[0]).toBe(0x0b);
    expect([...frame.subarray(-2)]).toEqual([0x1c, 0x0d]);
  });

  it('refuses to ACK a missing or unsafe control ID', () => {
    expect(buildAckFrame({ ...oru, controlId: null }, 'mllp')).toBeNull();
    expect(buildAckFrame({ ...oru, controlId: 'a|b' }, 'mllp')).toBeNull();
  });
});
