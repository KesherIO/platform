import {
  buildDateRangeFilter,
  startOfTodayInTimezone,
} from './date-range.util';

describe('buildDateRangeFilter', () => {
  it('returns undefined when neither bound is given', () => {
    expect(buildDateRangeFilter()).toBeUndefined();
  });

  it('builds an inclusive gte/lte range, bumping dateTo to end of day', () => {
    const range = buildDateRangeFilter('2026-08-01', '2026-08-08');
    expect(range).toEqual({
      gte: new Date('2026-08-01'),
      lte: new Date('2026-08-08T23:59:59.999Z'),
    });
  });

  it('supports an open-ended range', () => {
    expect(buildDateRangeFilter('2026-08-01', undefined)).toEqual({
      gte: new Date('2026-08-01'),
    });
    expect(buildDateRangeFilter(undefined, '2026-08-08')).toEqual({
      lte: new Date('2026-08-08T23:59:59.999Z'),
    });
  });
});

describe('startOfTodayInTimezone', () => {
  it('returns midnight UTC for the UTC timezone', () => {
    const now = new Date('2026-08-08T15:30:00.000Z');
    expect(startOfTodayInTimezone('UTC', now).toISOString()).toBe(
      '2026-08-08T00:00:00.000Z'
    );
  });

  it('accounts for a positive UTC offset (lab ahead of UTC)', () => {
    // 23:30 UTC on the 8th is already 01:30 local on the 9th in Madrid (CEST, UTC+2).
    const now = new Date('2026-08-08T23:30:00.000Z');
    expect(startOfTodayInTimezone('Europe/Madrid', now).toISOString()).toBe(
      '2026-08-08T22:00:00.000Z'
    );
  });

  it('accounts for a negative UTC offset (lab behind UTC)', () => {
    // 04:00 UTC on the 8th is 23:00 local on the 7th in Bogotá (fixed UTC-5).
    const now = new Date('2026-08-08T04:00:00.000Z');
    expect(startOfTodayInTimezone('America/Bogota', now).toISOString()).toBe(
      '2026-08-07T05:00:00.000Z'
    );
  });
});
