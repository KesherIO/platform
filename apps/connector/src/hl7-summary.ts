/**
 * Minimal, read-only look into an HL7 payload so the receiver can show the
 * sample ID and name files. Raw bytes are never rewritten; full parsing and
 * analyte mapping happens server-side later.
 */

export interface Hl7Summary {
  /** MSH-3 / MSH-4 as sent (echoed back, swapped, in the ACK). */
  sendingApplication: string | null;
  sendingFacility: string | null;
  messageType: string | null;
  controlId: string | null;
  /** MSH-7 transmission timestamp (changes on resend). */
  messageTime: string | null;
  version: string | null;
  /** PID-3, first component: the analyzer's own sample ID (verified on screen). */
  sampleId: string | null;
  obxCount: number;
}

const first = (value: string | undefined): string | null => {
  const v = value?.split('~')[0]?.split('^')[0]?.trim();
  return v ? v : null;
};

export function summarizeHl7(payload: Buffer): Hl7Summary {
  const segments = payload.toString('utf8').split(/\r\n|\r|\n/);
  let msh: string[] = [];
  let pid: string[] = [];
  let obxCount = 0;
  for (const segment of segments) {
    if (segment.startsWith('MSH|')) msh = segment.split('|');
    else if (segment.startsWith('PID|') && pid.length === 0) pid = segment.split('|');
    else if (segment.startsWith('OBX|')) obxCount++;
  }
  // MSH-1 is the separator itself, so MSH-n sits at index n-1.
  return {
    sendingApplication: msh[2]?.trim() || null,
    sendingFacility: msh[3]?.trim() || null,
    messageType: msh[8]?.trim() || null,
    controlId: msh[9]?.trim() || null,
    messageTime: msh[6]?.trim() || null,
    version: msh[11]?.trim() || null,
    sampleId: first(pid[3]),
    obxCount,
  };
}
