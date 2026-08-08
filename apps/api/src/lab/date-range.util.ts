/**
 * Builds a Prisma-compatible date range filter from "YYYY-MM-DD" query params,
 * inclusive on both ends — dateTo is bumped to the last instant of that day so
 * a same-day range (dateFrom === dateTo) still matches records from that day.
 */
export function buildDateRangeFilter(
  dateFrom?: string,
  dateTo?: string
): { gte?: Date; lte?: Date } | undefined {
  if (!dateFrom && !dateTo) return undefined;

  const filter: { gte?: Date; lte?: Date } = {};
  if (dateFrom) filter.gte = new Date(dateFrom);
  if (dateTo) {
    const end = new Date(dateTo);
    end.setUTCHours(23, 59, 59, 999);
    filter.lte = end;
  }
  return filter;
}

/**
 * The UTC instant corresponding to local midnight "today" in the given IANA
 * timezone — used to scope "completed today" without a timezone library.
 * Works by reading the wall-clock date/time Intl reports for that zone,
 * treating it as if it were UTC to get the zone's current offset, then
 * applying that offset to midnight of the same calendar day.
 */
export function startOfTodayInTimezone(
  timezone: string,
  now: Date = new Date()
): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');

  const year = get('year');
  const month = get('month');
  const day = get('day');
  // Intl reports hour 24 for midnight in hour12:false mode on some engines —
  // normalize it to 0 so Date.UTC doesn't roll into the next day.
  const hour = get('hour') % 24;
  const minute = get('minute');
  const second = get('second');

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMs = wallClockAsUtc - now.getTime();
  const midnightAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  return new Date(midnightAsUtc - offsetMs);
}
