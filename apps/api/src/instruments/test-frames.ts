import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Wrap HL7 text exactly like the VH-30: <u32 BE L><0B>hl7<1C><0D>. */
export function makeFrame(hl7: string): Buffer {
  const body = Buffer.concat([Buffer.from([0x0b]), Buffer.from(hl7, 'utf8'), Buffer.from([0x1c, 0x0d])]);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(body.length);
  return Buffer.concat([prefix, body]);
}

/** Apply a text edit to a frame's HL7 and re-wrap it with a correct length prefix. */
export function rewriteFrame(frame: Buffer, edit: (hl7: string) => string): Buffer {
  const hl7 = frame.subarray(5, frame.length - 2).toString('utf8');
  const next = edit(hl7);
  if (next === hl7) throw new Error('rewriteFrame: edit changed nothing');
  return makeFrame(next);
}

/** Split a capture of back-to-back frames. */
export function splitFrames(capture: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  for (let off = 0; off < capture.length; ) {
    const len = capture.readUInt32BE(off) + 4;
    frames.push(Buffer.from(capture.subarray(off, off + len)));
    off += len;
  }
  return frames;
}

const CAPTURE = resolve(__dirname, '../../../../docs/VH30-test.hl7');
export const hasCapture = existsSync(CAPTURE);

/** The 5 real frames: samples 168, 169, 168 (resend), 1111, 1111 (resend). */
export const realFrames = (): Buffer[] => splitFrames(readFileSync(CAPTURE));

/** Small synthetic ORU for unit tests. */
export const sampleHl7 = (opts: { sampleId?: string; controlId?: string; time?: string; obs?: string; wbc?: string; flag?: string } = {}) =>
  [
    `MSH|^~\\&|Genrui|VH30|||${opts.time ?? '20261020090403'}||ORU^R01|${opts.controlId ?? '2577'}|P|2.3.1|||||CHA|UTF-8|||`,
    `PID|1||${opts.sampleId ?? '168'}|||dog||O|||||||||||||||||||||||`,
    'PV1|1|||||||||||||||||||||',
    `OBR|1||||||${opts.obs ?? '20261019191457'}|||||||||||Admin||||||||||||||Genrui||||||||`,
    `OBX|1|NM|^WBC^||${opts.wbc ?? '13.23'}|10^9/L|6.00-17.00||||F||${opts.flag ?? ''}|||||`,
    'OBX|2|NM|^HGB^||5.7|g/dL|11.0-19.0|L|||F||||||||',
    'OBX|3|IS|^WBC Alarm^||Leucocytosis\nLinfocitosis||||||F||||||||',
    'OBX|4|ED|^WBCHistogram_BMP^||^Image^BMP^Base64^516b32||||||F||||||||',
    '',
  ].join('\r');
