import {
  suggestBillingMappings,
  type MappingCatalogItem,
} from './billing-mapping.util';

const test = (
  id: string,
  code: string | null,
  name: string,
  billingCode: string | null = null
): MappingCatalogItem => ({ id, kind: 'TEST', code, name, billingCode });

const CATALOG: MappingCatalogItem[] = [
  test('alt', 'ALT', 'Transaminasas T.G.P. (ALT)'),
  test('alb', 'ALB', 'Albumina'),
  test('sdma', 'SDMA', 'SDMA'),
  test('hem', 'CBC', 'Hemograma sencillo automatizado'),
  test('hem2', 'CBC2', 'Hemograma completo automatizado'),
  {
    id: 'pren',
    kind: 'PACKAGE',
    code: 'PREN',
    name: 'Perfil renal',
    billingCode: null,
  },
];

const one = (code: string, description: string, catalog = CATALOG) =>
  suggestBillingMappings([{ code, description }], catalog)[0];

describe('suggestBillingMappings', () => {
  it('suggests a single exact name match, ignoring case, accents and punctuation', () => {
    const s = one('ALB', 'ALBÚMINA');
    expect(s).toMatchObject({
      status: 'SUGGESTED',
      suggestedCatalogItemId: 'alb',
    });
    expect(s.candidates[0].matchedBy).toBe('NAME');
  });

  it('maps a profile to the lab package by name, without touching components', () => {
    expect(one('PREN', 'Perfil renal')).toMatchObject({
      status: 'SUGGESTED',
      suggestedCatalogItemId: 'pren',
    });
  });

  it('only similar names are REVIEW, never auto-picked', () => {
    const s = one('HEM', 'Hemograma automatizado');
    expect(s.status).toBe('REVIEW');
    expect(s.suggestedCatalogItemId).toBeNull();
    expect(s.candidates.map((c) => c.catalogItemId).sort()).toEqual([
      'hem',
      'hem2',
    ]);
    expect(s.reasons).toContain('NOT_EXACT');
  });

  it('internal code match with an unrelated name is REVIEW', () => {
    const s = one('ALB', 'Algo completamente distinto');
    expect(s.status).toBe('REVIEW');
    expect(s.candidates[0]).toMatchObject({
      catalogItemId: 'alb',
      matchedBy: 'CODE',
    });
  });

  it('two catalog items with the same name are REVIEW (multiple candidates)', () => {
    const s = one('X', 'Albumina', [
      test('a', 'A1', 'Albumina'),
      test('b', 'A2', 'Albumina'),
    ]);
    expect(s.status).toBe('REVIEW');
    expect(s.reasons).toContain('MULTIPLE_CANDIDATES');
  });

  it('SDMA and SDMA022720261534 share a description: neither is chosen', () => {
    const out = suggestBillingMappings(
      [
        { code: 'SDMA', description: 'SDMA' },
        { code: 'SDMA022720261534', description: 'SDMA' },
      ],
      CATALOG
    );
    expect(out.map((s) => s.status)).toEqual(['REVIEW', 'REVIEW']);
    expect(out.map((s) => s.suggestedCatalogItemId)).toEqual([null, null]);
    for (const s of out) {
      expect(s.reasons).toContain('DUPLICATE_DESCRIPTION');
      expect(s.candidates[0].catalogItemId).toBe('sdma');
    }
  });

  it('the same billing code on two rows is REVIEW', () => {
    const out = suggestBillingMappings(
      [
        { code: 'ALB', description: 'Albumina' },
        { code: 'alb', description: 'Albumina sérica' },
      ],
      CATALOG
    );
    expect(out.every((s) => s.reasons.includes('DUPLICATE_CODE'))).toBe(true);
    expect(out.every((s) => s.status === 'REVIEW')).toBe(true);
  });

  it('a billing code already on another item is REVIEW', () => {
    const catalog = CATALOG.map((i) =>
      i.id === 'alt' ? { ...i, billingCode: 'ALB' } : i
    );
    const s = one('ALB', 'Albumina', catalog);
    expect(s.status).toBe('REVIEW');
    expect(s.reasons).toContain('CODE_ASSIGNED_ELSEWHERE');
  });

  it('two different rows that would claim the same item both go to review', () => {
    const out = suggestBillingMappings(
      [
        { code: 'ALB1', description: 'Albumina' },
        { code: 'ALB2', description: 'ALBUMINA.' },
      ],
      CATALOG
    );
    // same normalized description → already DUPLICATE_DESCRIPTION; and never both suggested
    expect(out.filter((s) => s.status === 'SUGGESTED')).toHaveLength(0);
  });

  it('rows the lab does not offer have no match and create nothing', () => {
    expect(one('BPCR', 'Babesia sp.')).toMatchObject({
      status: 'NO_MATCH',
      candidates: [],
      suggestedCatalogItemId: null,
    });
  });

  it('a row without a code is invalid', () => {
    expect(one('  ', 'Albumina').status).toBe('INVALID');
  });

  it('reports the current billing code of a candidate so the UI can warn on overwrite', () => {
    const catalog = CATALOG.map((i) =>
      i.id === 'alb' ? { ...i, billingCode: 'OLD' } : i
    );
    const s = one('ALB', 'Albumina', catalog);
    expect(s.status).toBe('SUGGESTED');
    expect(s.candidates[0].currentBillingCode).toBe('OLD');
  });
});
