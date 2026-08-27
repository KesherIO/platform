import { evaluateFormula, evaluateAllFormulas } from './formula.util';

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
    const result = evaluateFormula('([HGB]*10)/[RBC]', { HGB: 14.7, RBC: 6.76 });
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
    const result = evaluateFormula(
      '(2*([NA]+[K]))+([GLU]/18)+([BUN]/2.8)',
      { NA: 145, K: 4.5, GLU: 100, BUN: 15 }
    );
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
    expect(evaluateFormula('([A]+[B])*[C]', { A: 10, B: null, C: 5 })).toBeNull();
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
