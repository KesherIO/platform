/**
 * Calendar-day helpers for the billing export. The range the user picks is a
 * pair of "YYYY-MM-DD" days in the LAB's timezone (Tenant.timezone), and the
 * fecha column is the order's creation day in that same zone — never the
 * server's or the browser's.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MAX_RANGE_DAYS = 366;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** True for a real calendar day ("2026-02-30" is not). */
export function isValidDay(day: string): boolean {
  const m = DAY.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

export function addDays(day: string, days: number): string {
  const m = DAY.exec(day) as RegExpExecArray;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const ms = (day: string) => {
    const m = DAY.exec(day) as RegExpExecArray;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** Offset (ms) of `timezone` from UTC at the given instant. */
function offsetMs(instant: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const wallClockAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24, // some engines report midnight as hour 24
    get('minute'),
    get('second')
  );
  // Whole seconds only: `instant` may carry milliseconds the wall clock lacks
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant of 00:00 on `day` in `timezone`. Resolved twice so a day on
 * which the offset changes (daylight saving) still lands on local midnight.
 */
export function startOfDayInTimezone(day: string, timezone: string): Date {
  const m = DAY.exec(day) as RegExpExecArray;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let instant = wall - offsetMs(wall, timezone);
  instant = wall - offsetMs(instant, timezone);
  return new Date(instant);
}

/** "YYYY-MM-DD" of an instant as seen in `timezone`. */
export function formatDayInTimezone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Half-open [gte, lt) instants covering `dateFrom` through `dateTo`, both
 * days inclusive, in the lab's timezone.
 */
export function inclusiveDayRange(
  dateFrom: string,
  dateTo: string,
  timezone: string
): { gte: Date; lt: Date } {
  return {
    gte: startOfDayInTimezone(dateFrom, timezone),
    lt: startOfDayInTimezone(addDays(dateTo, 1), timezone),
  };
}
