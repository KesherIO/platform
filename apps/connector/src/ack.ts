import { LENGTH_PREFIX_BYTES, MLLP_CR, MLLP_END, MLLP_START } from './framing';
import type { Hl7Summary } from './hl7-summary';

/**
 * ACK^R01 per the vendor VH-30 LIS protocol PDF (not in the repo) section 2.3.1 / 3.6:
 * MSH + `MSA|AA|<control ID of the ORU>||||`, sent by the LIS after each result.
 *
 * The PDF does NOT say how the ACK is framed on the wire. Two candidates:
 *  - 'length-mllp': mirror what the analyzer sends  <u32 BE L><0B>HL7<1C><0D>
 *  - 'mllp':        plain MLLP                       <0B>HL7<1C><0D>
 * Which one the VH-30 accepts has to be confirmed on the device.
 */
export type AckFraming = 'length-mllp' | 'mllp';

/** MSH-10 is max 20 chars; refuse anything that would need HL7 escaping. */
const SAFE_CONTROL_ID = /^[A-Za-z0-9._-]{1,20}$/;

const pad = (n: number) => String(n).padStart(2, '0');
const hl7Time = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const safeField = (v: string | null) => (v && /^[A-Za-z0-9._ -]{1,40}$/.test(v) ? v : '');

export function buildAckPayload(hl7: Hl7Summary, code: 'AA' | 'AE' | 'AR' = 'AA', now = new Date()): string | null {
  const id = hl7.controlId;
  if (!id || !SAFE_CONTROL_ID.test(id)) return null;
  return [
    // sender/receiver swapped relative to the ORU
    `MSH|^~\\&|KesherIO|Connector|${safeField(hl7.sendingApplication)}|${safeField(hl7.sendingFacility)}|${hl7Time(now)}||ACK^R01|${id}|P|2.3.1`,
    `MSA|${code}|${id}||||`,
    '',
  ].join('\r');
}

export function frameAck(payload: string, framing: AckFraming): Buffer {
  const body = Buffer.concat([Buffer.from([MLLP_START]), Buffer.from(payload, 'utf8'), Buffer.from([MLLP_END, MLLP_CR])]);
  if (framing === 'mllp') return body;
  const prefix = Buffer.alloc(LENGTH_PREFIX_BYTES);
  prefix.writeUInt32BE(body.length);
  return Buffer.concat([prefix, body]);
}

export function buildAckFrame(hl7: Hl7Summary, framing: AckFraming, now = new Date()): Buffer | null {
  const payload = buildAckPayload(hl7, 'AA', now);
  return payload ? frameAck(payload, framing) : null;
}
