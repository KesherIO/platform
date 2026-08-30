import {
  evaluateFormula,
  evaluateAllFormulas,
  validateTemplateFormulas,
  extractCodeRefs,
} from './formula.util';

describe('evaluateFormula', () => {
  it('evaluates simple addition', () => {
    expect(evaluateFormula('[A]+[B]', { A: 10, B: 5 })).toBe(15);
  });

  it('evaluates subtraction', () => {
    expect(evaluateFormula('[A]-[B]', { A: 10, B: 3 })).toBe(7);
  });

  it('evaluates multiplication', () => {
    expect(evaluateFormula('[A]*[B]', { A: 4, B: 3 })).toBe(12);
  });

  it('evaluates division', () => {
    expect(evaluateFormula('[A]/[B]', { A: 10, B: 4 })).toBe(2.5);
  });

  it('respects operator precedence (* before +)', () => {
    expect(evaluateFormula('[A]+[B]*[C]', { A: 1, B: 2, C: 3 })).toBe(7);
  });

  it('evaluates MCV formula: ([HCT]*10)/[RBC]', () => {
    const result = evaluateFormula('([HCT]*10)/[RBC]', { HCT: 44, RBC: 6.76 });
    expect(result).toBeCloseTo(65.089, 2);
  });

  it('evaluates MCH formula: ([HGB]*10)/[RBC]', () => {
    const result = evaluateFormula('([HGB]*10)/[RBC]', {
      HGB: 14.7,
      RBC: 6.76,
    });
    expect(result).toBeCloseTo(21.746, 2);
  });

  it('evaluates MCHC formula: ([HGB]*100)/[HCT]', () => {
    const result = evaluateFormula('([HGB]*100)/[HCT]', { HGB: 14.7, HCT: 44 });
    expect(result).toBeCloseTo(33.409, 2);
  });

  it('evaluates differential absolute: ([NEU_PCT]*[WBC])/100', () => {
    const result = evaluateFormula('([NEU_PCT]*[WBC])/100', {
      NEU_PCT: 77,
      WBC: 11.3,
    });
    expect(result).toBeCloseTo(8.701, 2);
  });

  it('evaluates complex osmolarity formula', () => {
    const result = evaluateFormula('(2*([NA]+[K]))+([GLU]/18)+([BUN]/2.8)', {
      NA: 145,
      K: 4.5,
      GLU: 100,
      BUN: 15,
    });
    expect(result).toBeCloseTo(309.913, 1);
  });

  it('handles nested parentheses', () => {
    expect(evaluateFormula('((1+2)*(3+4))', {})).toBe(21);
  });

  it('handles unary minus', () => {
    expect(evaluateFormula('-[A]', { A: 5 })).toBe(-5);
  });

  it('handles numeric literals', () => {
    expect(evaluateFormula('10/2.5', {})).toBe(4);
  });

  it('returns null for division by zero', () => {
    expect(evaluateFormula('[A]/[B]', { A: 10, B: 0 })).toBeNull();
  });

  it('returns null for unknown code reference', () => {
    expect(evaluateFormula('[A]+[B]', { A: 10 })).toBeNull();
  });

  it('returns null when referenced value is null', () => {
    expect(evaluateFormula('[A]+[B]', { A: 10, B: null })).toBeNull();
  });

  it('propagates null through operations', () => {
    expect(
      evaluateFormula('([A]+[B])*[C]', { A: 10, B: null, C: 5 })
    ).toBeNull();
  });

  it('returns null for empty formula', () => {
    expect(evaluateFormula('', {})).toBeNull();
    expect(evaluateFormula('  ', {})).toBeNull();
  });

  it('returns null for NaN/Infinity results', () => {
    // 0/0 → NaN → null
    expect(evaluateFormula('[A]/[B]', { A: 0, B: 0 })).toBeNull();
  });

  it('throws on invalid formula syntax', () => {
    expect(() => evaluateFormula('[A]++[B]', { A: 1, B: 2 })).toThrow();
  });

  it('throws on unclosed bracket', () => {
    expect(() => evaluateFormula('[ABC', {})).toThrow(/Unclosed bracket/);
  });

  it('throws on unclosed parenthesis', () => {
    expect(() => evaluateFormula('([A]+[B]', { A: 1, B: 2 })).toThrow();
  });
});

describe('evaluateAllFormulas', () => {
  it('computes formula analytes from input analytes', () => {
    const result = evaluateAllFormulas([
      { code: 'HCT', formula: null, numericValue: 44 },
      { code: 'RBC', formula: null, numericValue: 6.76 },
      { code: 'MCV', formula: '([HCT]*10)/[RBC]', numericValue: null },
    ]);
    expect(result['MCV']).toBeCloseTo(65.089, 2);
    expect(result['HCT']).toBe(44);
    expect(result['RBC']).toBe(6.76);
  });

  it('handles formula depending on another formula', () => {
    const result = evaluateAllFormulas([
      { code: 'A', formula: null, numericValue: 10 },
      { code: 'B', formula: '[A]*2', numericValue: null },
      { code: 'C', formula: '[B]+5', numericValue: null },
    ]);
    expect(result['B']).toBe(20);
    expect(result['C']).toBe(25);
  });

  it('detects circular dependencies', () => {
    expect(() =>
      evaluateAllFormulas([
        { code: 'A', formula: '[B]*2', numericValue: null },
        { code: 'B', formula: '[A]+1', numericValue: null },
      ])
    ).toThrow(/Circular formula dependency/);
  });

  it('returns null for formulas with missing input values', () => {
    const result = evaluateAllFormulas([
      { code: 'A', formula: null, numericValue: null },
      { code: 'B', formula: '[A]*2', numericValue: null },
    ]);
    expect(result['B']).toBeNull();
  });

  it('returns input values when no formulas exist', () => {
    const result = evaluateAllFormulas([
      { code: 'A', formula: null, numericValue: 10 },
      { code: 'B', formula: null, numericValue: 20 },
    ]);
    expect(result).toEqual({ A: 10, B: 20 });
  });

  it('handles multiple independent formulas', () => {
    const result = evaluateAllFormulas([
      { code: 'WBC', formula: null, numericValue: 11.3 },
      { code: 'NEU_PCT', formula: null, numericValue: 77 },
      { code: 'LYM_PCT', formula: null, numericValue: 21 },
      { code: 'NEU_ABS', formula: '([NEU_PCT]*[WBC])/100', numericValue: null },
      { code: 'LYM_ABS', formula: '([LYM_PCT]*[WBC])/100', numericValue: null },
    ]);
    expect(result['NEU_ABS']).toBeCloseTo(8.701, 2);
    expect(result['LYM_ABS']).toBeCloseTo(2.373, 2);
  });

  it('handles empty analyte list', () => {
    expect(evaluateAllFormulas([])).toEqual({});
  });
});

describe('extractCodeRefs', () => {
  it('extracts code references from a formula', () => {
    expect(extractCodeRefs('([HCT]*10)/[RBC]')).toEqual(['HCT', 'RBC']);
  });

  it('returns empty array for formula with no refs', () => {
    expect(extractCodeRefs('10+5')).toEqual([]);
  });
});

describe('validateTemplateFormulas', () => {
  const section = (
    analytes: Array<{
      code: string;
      name: string;
      formula?: string | null;
      isHeader?: boolean;
    }>
  ) => [{ name: 'Section A', analytes }];

  it('returns empty array for valid template without formulas', () => {
    const errors = validateTemplateFormulas(
      section([
        { code: 'WBC', name: 'White Blood Cells' },
        { code: 'RBC', name: 'Red Blood Cells' },
      ])
    );
    expect(errors).toEqual([]);
  });

  it('returns empty array for valid formulas referencing known codes', () => {
    const errors = validateTemplateFormulas(
      section([
        { code: 'HCT', name: 'Hematocrit' },
        { code: 'RBC', name: 'Red Blood Cells' },
        {
          code: 'MCV',
          name: 'Mean Corpuscular Volume',
          formula: '([HCT]*10)/[RBC]',
        },
      ])
    );
    expect(errors).toEqual([]);
  });

  it('detects unknown code references', () => {
    const errors = validateTemplateFormulas(
      section([
        { code: 'HCT', name: 'Hematocrit' },
        { code: 'MCV', name: 'MCV', formula: '([HCT]*10)/[RBC]' },
      ])
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].analyteCode).toBe('MCV');
    expect(errors[0].errors).toHaveLength(1);
    expect(errors[0].errors[0].code).toBe('UNKNOWN_REF');
    expect(errors[0].errors[0].ref).toBe('RBC');
  });

  it('detects self-references', () => {
    const errors = validateTemplateFormulas(
      section([{ code: 'A', name: 'A', formula: '[A]+1' }])
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].errors[0].code).toBe('SELF_REFERENCE');
    expect(errors[0].errors[0].ref).toBe('A');
  });

  it('detects circular dependencies between two formulas', () => {
    const errors = validateTemplateFormulas(
      section([
        { code: 'A', name: 'A', formula: '[B]*2' },
        { code: 'B', name: 'B', formula: '[A]+1' },
      ])
    );
    const allCodes = errors.flatMap((e) => e.errors.map((err) => err.code));
    expect(allCodes).toContain('CIRCULAR_DEPENDENCY');
  });

  it('detects syntax errors in formulas', () => {
    const errors = validateTemplateFormulas(
      section([
        { code: 'WBC', name: 'WBC' },
        { code: 'CALC', name: 'Calc', formula: '[WBC] @ 5' },
      ])
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].errors[0].code).toBe('SYNTAX_ERROR');
  });

  it('skips header analytes', () => {
    const errors = validateTemplateFormulas(
      section([
        {
          code: 'HEADER',
          name: 'Header Row',
          isHeader: true,
          formula: '[MISSING]',
        },
        { code: 'WBC', name: 'WBC' },
      ])
    );
    expect(errors).toEqual([]);
  });

  it('detects multiple errors on the same analyte', () => {
    const errors = validateTemplateFormulas(
      section([{ code: 'A', name: 'A', formula: '[A]+[MISSING]' }])
    );
    expect(errors).toHaveLength(1);
    const codes = errors[0].errors.map((e) => e.code);
    expect(codes).toContain('SELF_REFERENCE');
    expect(codes).toContain('UNKNOWN_REF');
  });

  it('validates across multiple sections', () => {
    const errors = validateTemplateFormulas([
      {
        name: 'Section 1',
        analytes: [
          { code: 'A', name: 'A' },
          { code: 'B', name: 'B' },
        ],
      },
      {
        name: 'Section 2',
        analytes: [{ code: 'C', name: 'C', formula: '[A]+[B]' }],
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('returns empty for templates with null/empty formulas', () => {
    const errors = validateTemplateFormulas(
      section([
        { code: 'A', name: 'A', formula: null },
        { code: 'B', name: 'B', formula: '' },
        { code: 'C', name: 'C', formula: '  ' },
      ])
    );
    expect(errors).toEqual([]);
  });

  it('handles formula referencing known code from another section', () => {
    const errors = validateTemplateFormulas([
      {
        name: 'Hematology',
        analytes: [{ code: 'HGB', name: 'Hemoglobin' }],
      },
      {
        name: 'Indices',
        analytes: [
          { code: 'HCT', name: 'Hematocrit' },
          { code: 'MCHC', name: 'MCHC', formula: '([HGB]*100)/[HCT]' },
        ],
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('detects duplicate analyte codes across sections and reports both', () => {
    const errors = validateTemplateFormulas([
      {
        name: 'Section A',
        analytes: [{ code: 'WBC', name: 'White Blood Cells' }],
      },
      {
        name: 'Section B',
        analytes: [{ code: 'WBC', name: 'WBC duplicate' }],
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].analyteCode).toBe('WBC');
    expect(errors[0].errors[0].code).toBe('DUPLICATE_CODE');
    expect(errors[0].errors[0].message).toContain('Section A');
    expect(errors[0].errors[0].message).toContain('Section B');
    expect(errors[0].errors[0].message).toContain('White Blood Cells');
    expect(errors[0].errors[0].message).toContain('WBC duplicate');
  });

  it('detects duplicate codes within same section and reports both analytes', () => {
    const errors = validateTemplateFormulas(
      section([
        { code: 'A', name: 'Analyte A' },
        { code: 'A', name: 'Analyte A duplicate' },
      ])
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].errors[0].code).toBe('DUPLICATE_CODE');
    expect(errors[0].errors[0].message).toContain('Analyte A');
    expect(errors[0].errors[0].message).toContain('Analyte A duplicate');
  });
});
