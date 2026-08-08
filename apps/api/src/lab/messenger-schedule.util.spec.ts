import { BadRequestException } from '@nestjs/common';
import {
  validateWeeklySchedule,
  isWithinSchedule,
} from './messenger-schedule.util';

const ALL_OFF = {
  MONDAY: null,
  TUESDAY: null,
  WEDNESDAY: null,
  THURSDAY: null,
  FRIDAY: null,
  SATURDAY: null,
  SUNDAY: null,
};

describe('validateWeeklySchedule', () => {
  it('accepts a fully-null schedule', () => {
    expect(validateWeeklySchedule(ALL_OFF)).toEqual(ALL_OFF);
  });

  it('accepts a valid day range and fills omitted days with null', () => {
    const result = validateWeeklySchedule({
      MONDAY: { start: '09:00', end: '17:00' },
    });
    expect(result.MONDAY).toEqual({ start: '09:00', end: '17:00' });
    expect(result.TUESDAY).toBeNull();
  });

  it('rejects a non-object input', () => {
    expect(() => validateWeeklySchedule('nope')).toThrow(BadRequestException);
    expect(() => validateWeeklySchedule(null)).toThrow(BadRequestException);
  });

  it('rejects a day range missing start/end', () => {
    expect(() =>
      validateWeeklySchedule({ MONDAY: { start: '09:00' } })
    ).toThrow(BadRequestException);
  });

  it('rejects an invalid time format', () => {
    expect(() =>
      validateWeeklySchedule({ MONDAY: { start: '25:00', end: '17:00' } })
    ).toThrow(BadRequestException);
    expect(() =>
      validateWeeklySchedule({ MONDAY: { start: '9:00', end: '17:00' } })
    ).toThrow(BadRequestException);
  });

  it('rejects a range where start is not before end', () => {
    expect(() =>
      validateWeeklySchedule({ MONDAY: { start: '17:00', end: '09:00' } })
    ).toThrow(BadRequestException);
    expect(() =>
      validateWeeklySchedule({ MONDAY: { start: '09:00', end: '09:00' } })
    ).toThrow(BadRequestException);
  });
});

describe('isWithinSchedule', () => {
  it('returns false for a null schedule', () => {
    expect(isWithinSchedule(null, 'UTC')).toBe(false);
  });

  it('returns false when today has no range', () => {
    // 2026-08-10 is a Monday
    const now = new Date('2026-08-10T12:00:00Z');
    const schedule = { ...ALL_OFF, TUESDAY: { start: '09:00', end: '17:00' } };
    expect(isWithinSchedule(schedule, 'UTC', now)).toBe(false);
  });

  it("returns true when now falls within today's range in the given timezone", () => {
    // 2026-08-10 is a Monday; 12:00 UTC
    const now = new Date('2026-08-10T12:00:00Z');
    const schedule = { ...ALL_OFF, MONDAY: { start: '09:00', end: '17:00' } };
    expect(isWithinSchedule(schedule, 'UTC', now)).toBe(true);
  });

  it("returns false when now falls outside today's range in the given timezone", () => {
    const now = new Date('2026-08-10T20:00:00Z');
    const schedule = { ...ALL_OFF, MONDAY: { start: '09:00', end: '17:00' } };
    expect(isWithinSchedule(schedule, 'UTC', now)).toBe(false);
  });

  it('evaluates against the given timezone, not UTC', () => {
    // 2026-08-10T02:00:00Z is 2026-08-09 22:00 in America/New_York (still Sunday)
    const now = new Date('2026-08-10T02:00:00Z');
    const schedule = {
      ...ALL_OFF,
      SUNDAY: { start: '20:00', end: '23:59' },
      MONDAY: { start: '09:00', end: '17:00' },
    };
    expect(isWithinSchedule(schedule, 'America/New_York', now)).toBe(true);
    expect(isWithinSchedule(schedule, 'UTC', now)).toBe(false);
  });
});
