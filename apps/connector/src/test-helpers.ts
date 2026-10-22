import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Build a frame exactly like the VH-30: <u32 BE L><0B><hl7><1C><0D>. */
export function makeFrame(hl7: string): Buffer {
  const body = Buffer.concat([
    Buffer.from([0x0b]),
    Buffer.from(hl7, 'latin1'),
    Buffer.from([0x1c, 0x0d]),
  ]);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(body.length);
  return Buffer.concat([prefix, body]);
}

export const hl7For = (
  sampleId: string,
  controlId: string,
  time = '20261020090403'
) =>
  [
    `MSH|^~\\&|Genrui|VH30|||${time}||ORU^R01|${controlId}|P|2.3.1|||||CHA|UTF-8|||`,
    `PID|1||${sampleId}|||dog||O|||||||||||||||||||||||`,
    'OBX|1|NM|^WBC^||13.23|10^9/L|6.00-17.00||||F||||||||',
    'OBX|2|NM|^Lym#^||7.70|10^9/L|0.83-4.91|H|||F||||||||',
    '',
  ].join('\r');

/** Real device capture committed under docs/, or null if it is not present. */
export function loadRealCapture(): Buffer | null {
  const path = resolve(__dirname, '../../../docs/VH30-test.hl7');
  return existsSync(path) ? readFileSync(path) : null;
}
