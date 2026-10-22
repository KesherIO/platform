import { createHash } from 'node:crypto';

/**
 * Parser for the ORU^R01 messages the Genrui VH-30 sends (verified on a real
 * capture, docs/VH30-test.hl7). The device wraps every message as
 *
 *   [uint32 BE L][0x0B][HL7][0x1C][0x0D]      L = bytes after the prefix
 *
 * Segments end with CR only. A value may contain a literal LF (e.g. alarm
 * lists), so segments are split on CR and never on LF.
 */

export class InvalidFrameError extends Error {}

export interface ParsedObx {
  setId: string;
  valueType: string;
  /** OBX-3 component 2 (e.g. "WBC", "Lym#"); falls back to component 1. */
  code: string;
  value: string;
  unit: string;
  referenceRange: string;
  /** OBX-8: H / L / empty */
  abnormalFlag: string;
  resultStatus: string;
  /** OBX-13: E/e = edited on the analyzer, O = expired reagent, empty = unedited. */
  userFlag: string;
  isImage: boolean;
}

export interface ParsedOru {
  messageType: string | null;
  controlId: string | null;
  /** MSH-7: transmission time, changes on every resend. */
  messageTime: string | null;
  version: string | null;
  sendingApplication: string | null;
  sendingFacility: string | null;
  charset: string | null;
  patient: {
    /** PID-3: the analyzer's own sample ID. Never an order number. */
    sampleId: string | null;
    name: string | null; // PID-5
    speciesText: string | null; // PID-6 (this device puts the species here)
    sex: string | null; // PID-8
  };
  /** OBR-7 as sent (yyyymmddhhmmss): when the analyzer ran the sample. */
  observationTimeRaw: string | null;
  observations: ParsedObx[];
}

const LENGTH_PREFIX = 4;

/** Strip the length prefix + MLLP wrapper, verifying both. Throws InvalidFrameError. */
export function decodeFrame(frame: Buffer): Buffer {
  if (frame.length < LENGTH_PREFIX + 4) throw new InvalidFrameError('Frame too short');
  const declared = frame.readUInt32BE(0);
  if (declared !== frame.length - LENGTH_PREFIX) {
    throw new InvalidFrameError(
      `Length prefix says ${declared} bytes but ${frame.length - LENGTH_PREFIX} follow`
    );
  }
  if (frame[LENGTH_PREFIX] !== 0x0b) throw new InvalidFrameError('Missing 0x0B start byte');
  if (frame[frame.length - 2] !== 0x1c || frame[frame.length - 1] !== 0x0d) {
    throw new InvalidFrameError('Missing 0x1C 0x0D trailer');
  }
  return frame.subarray(LENGTH_PREFIX + 1, frame.length - 2);
}

const field = (parts: string[], index: number): string => (parts[index] ?? '').trim();
const orNull = (v: string): string | null => (v === '' ? null : v);

export function parseOru(payload: Buffer): ParsedOru {
  const segments = payload.toString('utf8').split('\r');
  let msh: string[] | null = null;
  let pid: string[] = [];
  let obr: string[] = [];
  const observations: ParsedObx[] = [];

  for (const segment of segments) {
    if (segment.startsWith('MSH|')) msh = segment.split('|');
    else if (segment.startsWith('PID|') && pid.length === 0) pid = segment.split('|');
    else if (segment.startsWith('OBR|') && obr.length === 0) obr = segment.split('|');
    else if (segment.startsWith('OBX|')) {
      const p = segment.split('|');
      const id = field(p, 3).split('^');
      const valueType = field(p, 2);
      observations.push({
        setId: field(p, 1),
        valueType,
        code: (id[1] ?? '').trim() || (id[0] ?? '').trim(),
        // OBX-5 verbatim (alarms contain LF); trim only trailing/leading spaces
        value: (p[5] ?? '').trim(),
        unit: field(p, 6),
        referenceRange: field(p, 7),
        abnormalFlag: field(p, 8),
        resultStatus: field(p, 11),
        userFlag: field(p, 13),
        isImage: valueType === 'ED',
      });
    }
  }
  if (!msh) throw new InvalidFrameError('No MSH segment');
  // MSH-1 is the separator itself, so MSH-n is at index n-1
  const type = field(msh, 8);
  if (!type.startsWith('ORU^R01')) throw new InvalidFrameError(`Unsupported message type "${type}"`);

  return {
    messageType: orNull(type),
    controlId: orNull(field(msh, 9)),
    messageTime: orNull(field(msh, 6)),
    version: orNull(field(msh, 11)),
    sendingApplication: orNull(field(msh, 2)),
    sendingFacility: orNull(field(msh, 3)),
    charset: orNull(field(msh, 17)),
    patient: {
      sampleId: orNull(field(pid, 3).split('^')[0]),
      name: orNull(field(pid, 5)),
      speciesText: orNull(field(pid, 6)),
      sex: orNull(field(pid, 8)),
    },
    observationTimeRaw: orNull(field(obr, 7)),
    observations,
  };
}

function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** yyyymmddhhmmss in the lab's IANA time zone (the analyzer sends its local clock) -> Date. */
export function parseHl7Time(raw: string | null, timeZone = 'UTC'): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(raw ?? '');
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (Number.isNaN(wall)) return null;
  let tz = timeZone;
  try {
    zoneOffsetMinutes(tz, new Date(wall));
  } catch {
    tz = 'UTC';
  }
  const first = wall - zoneOffsetMinutes(tz, new Date(wall)) * 60_000;
  const second = wall - zoneOffsetMinutes(tz, new Date(first)) * 60_000; // settles DST edges
  return new Date(second);
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Hash of the result CONTENT: everything except MSH-7 (changes on every resend)
 * and MSH-10 (message identity, tracked separately). Includes the patient
 * fields, observation time, every parameter with unit / reference range / both
 * flags, and a hash of each embedded image. Two resends of the same result hash
 * equal; any edit to a value, flag, unit, range, name or histogram does not.
 */
export function contentHash(oru: ParsedOru, payload: Buffer): string {
  const imageHash = new Map<string, string>();
  for (const segment of payload.toString('utf8').split('\r')) {
    if (!segment.startsWith('OBX|')) continue;
    const p = segment.split('|');
    if (field(p, 2) === 'ED') imageHash.set(field(p, 1), sha(p[5] ?? ''));
  }
  const lines = [
    `PID|${oru.patient.sampleId ?? ''}|${oru.patient.name ?? ''}|${oru.patient.speciesText ?? ''}|${oru.patient.sex ?? ''}`,
    `OBR7|${oru.observationTimeRaw ?? ''}`,
    ...oru.observations.map((o) =>
      o.isImage
        ? `IMG|${o.setId}|${o.code}|${imageHash.get(o.setId) ?? ''}`
        : `OBX|${o.setId}|${o.valueType}|${o.code}|${o.value}|${o.unit}|${o.referenceRange}|${o.abnormalFlag}|${o.resultStatus}|${o.userFlag}`
    ),
  ];
  return sha(lines.join('\n'));
}

export interface ParsedParameter {
  code: string;
  value: string;
  unit: string;
  referenceRange: string;
  abnormalFlag: string;
  userFlag: string;
}

/** Compact form kept on the message row for the review screen (no image data). */
export function toStoredSummary(oru: ParsedOru, payload: Buffer) {
  const imageHash = new Map<string, string>();
  for (const segment of payload.toString('utf8').split('\r')) {
    if (!segment.startsWith('OBX|')) continue;
    const p = segment.split('|');
    if (field(p, 2) === 'ED') imageHash.set(field(p, 1), sha(p[5] ?? ''));
  }
  return {
    patient: oru.patient,
    sendingApplication: oru.sendingApplication,
    sendingFacility: oru.sendingFacility,
    observationTimeRaw: oru.observationTimeRaw,
    parameters: oru.observations
      .filter((o) => !o.isImage)
      .map<ParsedParameter & { valueType: string }>((o) => ({
        code: o.code,
        valueType: o.valueType,
        value: o.value,
        unit: o.unit,
        referenceRange: o.referenceRange,
        abnormalFlag: o.abnormalFlag,
        userFlag: o.userFlag,
      })),
    images: oru.observations
      .filter((o) => o.isImage)
      .map((o) => ({ code: o.code, hash: imageHash.get(o.setId) ?? '' })),
  };
}

export type StoredSummary = ReturnType<typeof toStoredSummary>;

export interface MessageDiff {
  changed: Array<{ code: string; before: ParsedParameter; after: ParsedParameter }>;
  added: ParsedParameter[];
  removed: ParsedParameter[];
  imagesChanged: string[];
  patientChanged: Array<{ field: string; before: string | null; after: string | null }>;
}

export const diffSummaries = (before: StoredSummary, after: StoredSummary): MessageDiff => {
  const key = (p: ParsedParameter) => p.code;
  const b = new Map(before.parameters.map((p) => [key(p), p]));
  const a = new Map(after.parameters.map((p) => [key(p), p]));
  const same = (x: ParsedParameter, y: ParsedParameter) =>
    x.value === y.value &&
    x.unit === y.unit &&
    x.referenceRange === y.referenceRange &&
    x.abnormalFlag === y.abnormalFlag &&
    x.userFlag === y.userFlag;

  const changed: MessageDiff['changed'] = [];
  for (const [code, after1] of a) {
    const before1 = b.get(code);
    if (before1 && !same(before1, after1)) changed.push({ code, before: before1, after: after1 });
  }
  const bi = new Map(before.images.map((i) => [i.code, i.hash]));
  const ai = new Map(after.images.map((i) => [i.code, i.hash]));
  const imagesChanged = [...new Set([...bi.keys(), ...ai.keys()])].filter((c) => bi.get(c) !== ai.get(c));

  const patientChanged: MessageDiff['patientChanged'] = [];
  for (const f of ['sampleId', 'name', 'speciesText', 'sex'] as const) {
    if (before.patient[f] !== after.patient[f]) {
      patientChanged.push({ field: f, before: before.patient[f], after: after.patient[f] });
    }
  }
  return {
    changed,
    added: [...a].filter(([c]) => !b.has(c)).map(([, p]) => p),
    removed: [...b].filter(([c]) => !a.has(c)).map(([, p]) => p),
    imagesChanged,
    patientChanged,
  };
};

/**
 * Best-effort header read from bytes that are NOT a complete message
 * (interrupted transfer). For display only — the message is never imported.
 */
export function peekHeader(bytes: Buffer): { controlId: string | null; sampleId: string | null; messageTime: string | null } {
  const text = bytes.subarray(0, 4096).toString('latin1');
  const msh = /MSH\|[^\r]*/.exec(text)?.[0].split('|');
  const pid = /PID\|[^\r]*/.exec(text)?.[0].split('|');
  return {
    controlId: msh ? orNull(field(msh, 9)) : null,
    messageTime: msh ? orNull(field(msh, 6)) : null,
    sampleId: pid ? orNull(field(pid, 3).split('^')[0]) : null,
  };
}
