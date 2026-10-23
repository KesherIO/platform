import {
  analyzerNumberFor,
  requisitionForAnalyzerNumber,
} from './analyzer-number.util';

describe('analyzer number', () => {
  it.each([
    ['REQ-2026-000001', '26000001'],
    ['REQ-2026-000012', '26000012'],
    ['REQ-2026-001234', '26001234'],
    ['REQ-2027-000012', '27000012'],
  ])('%s ⇄ %s', (requisition, number) => {
    expect(analyzerNumberFor(requisition)).toBe(number);
    expect(requisitionForAnalyzerNumber(number)).toBe(requisition);
  });

  it('keeps the year: the same sequence in different years gives different numbers', () => {
    expect(analyzerNumberFor('REQ-2026-000012')).not.toBe(
      analyzerNumberFor('REQ-2027-000012')
    );
  });

  it.each([
    'DEV-VH30-0F3A84', // seed order
    'IT-1a2b3c4d', // test fixtures
    'REQ-2026-1000000', // 7-digit sequence (overflow)
    'REQ-2026-12', // short sequence
    'REQ-26-000012',
    ' REQ-2026-000012',
  ])('legacy or malformed requisition %p has no analyzer number', (r) => {
    expect(analyzerNumberFor(r)).toBeNull();
  });

  it.each([
    '168', // the analyzer's own counter
    '1111',
    '2600012', // 7 digits
    '260000123', // 9 digits
    '026000012',
    '26000012 ',
    '2600001A',
    '26-000012',
    '',
  ])('%p is not an analyzer number', (s) => {
    expect(requisitionForAnalyzerNumber(s)).toBeNull();
  });
});
