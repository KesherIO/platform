import type { TFunction } from 'i18next';
import type {
  ImportBucket,
  ImportIssue,
  ImportPreviewRow,
  ImportRowResult,
} from '../../types/lab.types';
import {
  checkKey,
  rowIssues,
  serverErrors,
  unconfirmedWarnings,
} from '../../shared/clientImport';

/** "Email: Not a valid email" */
export function issueText(
  t: TFunction,
  issue: Pick<ImportIssue, 'field' | 'code'>
): string {
  return `${t(`clients.import.fields.${issue.field}`, {
    defaultValue: issue.field,
  })}: ${t(`clients.import.issues.${issue.code}`)}`;
}

function latestResult(row: ImportPreviewRow): ImportRowResult | null {
  if (row.imported && row.imported !== 'not_confirmed') return row.imported;
  if (row.check && row.check.key === checkKey(row.values)) {
    return row.check.result;
  }
  return null;
}

/** Why a row is in its bucket — shown in the preview, result and retry file. */
export function rowReason(
  t: TFunction,
  row: ImportPreviewRow,
  bucket: ImportBucket
): string {
  const result = latestResult(row);
  switch (bucket) {
    case 'invalid':
      return [
        ...rowIssues(row).filter((i) => i.severity === 'error'),
        ...serverErrors(row),
      ]
        .map((i) => issueText(t, i))
        .join('; ');
    case 'needs_review':
      return unconfirmedWarnings(row, rowIssues(row))
        .map((i) => issueText(t, i))
        .join('; ');
    case 'already_in_lab':
    case 'duplicate_in_file':
    case 'failed':
      if (result && 'reason' in result) {
        return t(`clients.import.reasons.${result.reason}`);
      }
      return bucket === 'duplicate_in_file'
        ? t('clients.import.reasons.DUPLICATE_IN_FILE')
        : '';
    case 'not_confirmed':
      return t('clients.import.reasons.NOT_CONFIRMED');
    default:
      return '';
  }
}

export const BUCKET_STYLES: Record<ImportBucket, string> = {
  will_create: 'bg-cyan/15 text-cyan',
  created: 'bg-green-900/30 text-green-300',
  checking: 'bg-gray-800 text-gray-400',
  needs_review: 'bg-yellow-900/30 text-yellow-300',
  already_in_lab: 'bg-gray-800 text-gray-300',
  duplicate_in_file: 'bg-gray-800 text-gray-300',
  invalid: 'bg-red-900/30 text-red-300',
  excluded: 'bg-gray-800 text-gray-500',
  failed: 'bg-red-900/30 text-red-300',
  not_confirmed: 'bg-purple/20 text-purple',
};

/** Browser download through a Blob URL. */
export function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
