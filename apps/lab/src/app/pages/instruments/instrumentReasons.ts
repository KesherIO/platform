import type { TFunction } from 'i18next';
import type { InstrumentMessageStatus } from '../../types/lab.types';

/** Reasons a reviewer may knowingly accept. Everything else must be fixed, then reprocessed. */
export const APPROVABLE = ['CONTENT_CHANGED', 'EXPIRED_REAGENT', 'EXISTING_MANUAL_VALUES', 'DRAFT_MODIFIED_SINCE_IMPORT'];

export const reasonCode = (reason: string) => reason.split(':')[0];

/** "UNIT_MISMATCH:HGB:g/L" -> "HGB (g/L)"; "NO_MATCHING_TEST:CBC" -> "CBC" */
function detail(reason: string): string {
  const [, a, b] = reason.split(':');
  return b !== undefined ? `${a} (${b})` : a ?? '';
}

export const reasonLabel = (t: TFunction, reason: string) =>
  t(`instruments.reasons.${reasonCode(reason)}`, { detail: detail(reason), defaultValue: reason });

export const STATUS_STYLE: Record<InstrumentMessageStatus, string> = {
  RECEIVED: 'bg-gray-400/15 text-gray-300',
  INCOMPLETE: 'bg-red-400/15 text-red-300',
  DUPLICATE: 'bg-gray-400/15 text-gray-400',
  UNMATCHED: 'bg-amber-400/15 text-amber-300',
  AMBIGUOUS: 'bg-amber-400/15 text-amber-300',
  NEEDS_REVIEW: 'bg-purple-400/15 text-purple-300',
  IMPORTED: 'bg-green-400/15 text-green-300',
  DISMISSED: 'bg-gray-400/15 text-gray-400',
  FAILED: 'bg-red-400/15 text-red-300',
};
