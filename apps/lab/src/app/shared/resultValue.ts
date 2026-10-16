/** A released analyte value, in any of its typed columns. */
export interface ResultValue {
  valueType: string | null;
  numericValue: number | null;
  textValue: string | null;
  booleanValue: boolean | null;
  selectValue: string | null;
}

// Result values are lab content (Spanish, as on the PDF), not UI strings —
// same rule as AmendmentValuesTable / ReviewReleasePage.
export function displayResultValue(v: ResultValue): string {
  switch (v.valueType) {
    case 'NUMERIC':
      return v.numericValue != null ? String(v.numericValue) : '—';
    case 'POSITIVE_NEGATIVE':
      return v.booleanValue === true
        ? 'Positivo'
        : v.booleanValue === false
        ? 'Negativo'
        : '—';
    case 'SELECT':
      return v.selectValue || '—';
    default:
      return (
        v.textValue || (v.numericValue != null ? String(v.numericValue) : '—')
      );
  }
}

/** Same colors as the review screen: high red, low blue. */
export function flagClass(flag: string | null): string {
  if (flag === 'H') return 'text-red-400';
  if (flag === 'L') return 'text-blue-400';
  return 'text-gray-200';
}

export function flagLabel(flag: string | null): string | null {
  if (flag === 'H') return '▲H';
  if (flag === 'L') return '▼L';
  return null;
}
