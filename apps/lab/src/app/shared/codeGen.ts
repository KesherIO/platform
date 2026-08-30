const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Normalize a display name into an uppercase snake-case code.
 * Returns null for empty/whitespace-only input.
 */
export function toStableCode(
  input: string,
  existingCodes?: string[],
  prefix?: 'SEC' | 'OBS'
): string | null {
  const normalized = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');

  if (!normalized) return null;

  let code = normalized;

  if (!CODE_PATTERN.test(code)) {
    const pfx = prefix ?? 'SEC';
    code = `${pfx}_${code}`;
  }

  if (!existingCodes?.length) return code;

  const existing = new Set(existingCodes);
  if (!existing.has(code)) return code;

  let suffix = 2;
  while (existing.has(`${code}_${suffix}`)) {
    suffix++;
  }
  return `${code}_${suffix}`;
}
