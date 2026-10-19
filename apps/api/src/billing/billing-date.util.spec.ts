import {
  addDays,
  formatDayInTimezone,
  inclusiveDayRange,
  isValidDay,
  isValidTimezone,
  startOfDayInTimezone,
} from './billing-date.util';

describe('billing date helpers', () => {
  it('validates real calendar days only', () => {
    expect(isValidDay('2026-10-18')).toBe(true);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('2026-2-3')).toBe(false);
    expect(isValidDay('18/10/2026')).toBe(false);
  });

  it('validates IANA timezones', () => {
    expect(isValidTimezone('America/Bogota')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  describe('America/Bogota (UTC-5, no DST)', () => {
    const tz = 'America/Bogota';

    it('local midnight is 05:00 UTC', () => {
      expect(startOfDayInTimezone('2026-10-18', tz).toISOString()).toBe(
        '2026-10-18T05:00:00.000Z'
      );
    });

    it('range is inclusive of the last day and exclusive of the next', () => {
      const { gte, lt } = inclusiveDayRange('2026-10-18', '2026-10-18', tz);
      expect(gte.toISOString()).toBe('2026-10-18T05:00:00.000Z');
      expect(lt.toISOString()).toBe('2026-10-19T05:00:00.000Z');
      const inRange = (iso: string) => {
        const t = new Date(iso).getTime();
        return t >= gte.getTime() && t < lt.getTime();
      };
      // 23:59:59.999 local on the 18th is in; 00:00:00.000 local on the 19th is out
      expect(inRange('2026-10-19T04:59:59.999Z')).toBe(true);
      expect(inRange('2026-10-19T05:00:00.000Z')).toBe(false);
      // 00:00:00.000 local on the 18th is in; one ms earlier is not
      expect(inRange('2026-10-18T05:00:00.000Z')).toBe(true);
      expect(inRange('2026-10-18T04:59:59.999Z')).toBe(false);
    });

    it('an evening order belongs to its local day, not the UTC day', () => {
      // 22:30 local on 2026-10-18 is already 2026-10-19 in UTC
      const order = new Date('2026-10-19T03:30:00Z');
      expect(formatDayInTimezone(order, tz)).toBe('2026-10-18');
    });
  });

  describe('daylight saving (America/New_York)', () => {
    const tz = 'America/New_York';

    it('finds local midnight on the spring-forward day (EST → EDT at 02:00)', () => {
      expect(startOfDayInTimezone('2026-03-08', tz).toISOString()).toBe(
        '2026-03-08T05:00:00.000Z'
      );
      expect(startOfDayInTimezone('2026-03-09', tz).toISOString()).toBe(
        '2026-03-09T04:00:00.000Z'
      );
    });

    it('that 23-hour day is still covered by a one-day range', () => {
      const { gte, lt } = inclusiveDayRange('2026-03-08', '2026-03-08', tz);
      expect((lt.getTime() - gte.getTime()) / 3_600_000).toBe(23);
    });

    it('fall-back day is 25 hours', () => {
      const { gte, lt } = inclusiveDayRange('2026-11-01', '2026-11-01', tz);
      expect((lt.getTime() - gte.getTime()) / 3_600_000).toBe(25);
    });
  });

  it('UTC lab: midnight is midnight', () => {
    expect(startOfDayInTimezone('2026-10-18', 'UTC').toISOString()).toBe(
      '2026-10-18T00:00:00.000Z'
    );
  });
});
