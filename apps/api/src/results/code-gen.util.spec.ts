import { toStableCode } from './code-gen.util';

describe('toStableCode', () => {
  it('normalizes a simple name', () => {
    expect(toStableCode('Examen Macroscópico')).toBe('EXAMEN_MACROSCOPICO');
  });

  it('normalizes accented characters via NFD', () => {
    expect(toStableCode('Química de la Orina')).toBe('QUIMICA_DE_LA_ORINA');
  });

  it('collapses consecutive underscores', () => {
    expect(toStableCode('A --- B')).toBe('A_B');
  });

  it('strips leading and trailing underscores', () => {
    expect(toStableCode('  hello  ')).toBe('HELLO');
  });

  it('returns null for empty input', () => {
    expect(toStableCode('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(toStableCode('   ')).toBeNull();
  });

  it('returns null for symbol-only input', () => {
    expect(toStableCode('---')).toBeNull();
  });

  it('prefixes with SEC when code starts with a digit', () => {
    expect(toStableCode('123 Test')).toBe('SEC_123_TEST');
  });

  it('uses OBS prefix when specified', () => {
    expect(toStableCode('123 Phrase', [], 'OBS')).toBe('OBS_123_PHRASE');
  });

  it('returns the code as-is when no collision', () => {
    expect(toStableCode('WBC', ['RBC'])).toBe('WBC');
  });

  it('appends _2 on first collision', () => {
    expect(toStableCode('WBC', ['WBC'])).toBe('WBC_2');
  });

  it('appends _3 when _2 also collides', () => {
    expect(toStableCode('WBC', ['WBC', 'WBC_2'])).toBe('WBC_3');
  });

  it('skips to _4 when _2 and _3 both collide', () => {
    expect(toStableCode('WBC', ['WBC', 'WBC_2', 'WBC_3'])).toBe('WBC_4');
  });

  it('does not collide when existingCodes is empty array', () => {
    expect(toStableCode('WBC', [])).toBe('WBC');
  });

  it('handles unicode combining marks', () => {
    expect(toStableCode('café')).toBe('CAFE');
  });

  it('handles mixed case and special characters', () => {
    expect(toStableCode('Hemo-Parásitos (Gota Gruesa)')).toBe(
      'HEMO_PARASITOS_GOTA_GRUESA'
    );
  });
});
