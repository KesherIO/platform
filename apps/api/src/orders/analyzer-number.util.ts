/**
 * The number a technician types into an analyzer ("Número de muestra") for an order:
 * the requisition number's two-digit year + its six-digit sequence.
 *
 *   REQ-2026-000012  ⇄  26000012
 *
 * One number per ORDER, shared by every analyzer and every tube of that order. It is
 * derived, never stored: requisition numbers are unique per lab (DB constraint) and never
 * edited, so the derived number is unique per lab too. Anything that does not round-trip
 * exactly (legacy or seed formats, a 7-digit sequence) simply has no analyzer number and
 * falls back to manual linking.
 */
const REQUISITION = /^REQ-20(\d{2})-(\d{6})$/;
const ANALYZER_NUMBER = /^(\d{2})(\d{6})$/;

export function analyzerNumberFor(requisitionNumber: string): string | null {
  const m = REQUISITION.exec(requisitionNumber);
  return m ? `${m[1]}${m[2]}` : null;
}

/** "26000012" → "REQ-2026-000012"; null for anything that is not exactly 8 digits. */
export function requisitionForAnalyzerNumber(sampleId: string): string | null {
  const m = ANALYZER_NUMBER.exec(sampleId);
  return m ? `REQ-20${m[1]}-${m[2]}` : null;
}
