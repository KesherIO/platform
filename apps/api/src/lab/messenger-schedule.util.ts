import { BadRequestException } from '@nestjs/common';

export const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type DayRange = { start: string; end: string } | null;

export type WeeklySchedule = Record<Weekday, DayRange>;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Validates a client-submitted weekly schedule object, throwing
 * BadRequestException on any malformed input. Returns the schedule narrowed
 * to WeeklySchedule so callers don't need further casting.
 */
export function validateWeeklySchedule(value: unknown): WeeklySchedule {
  if (typeof value !== 'object' || value === null) {
    throw new BadRequestException('schedule must be an object.');
  }
  const input = value as Record<string, unknown>;
  const result = {} as WeeklySchedule;

  for (const day of WEEKDAYS) {
    const range = input[day];
    if (range === null || range === undefined) {
      result[day] = null;
      continue;
    }
    if (
      typeof range !== 'object' ||
      typeof (range as DayRange)?.start !== 'string' ||
      typeof (range as DayRange)?.end !== 'string'
    ) {
      throw new BadRequestException(
        `schedule.${day} must be null or { start: "HH:mm", end: "HH:mm" }.`
      );
    }
    const { start, end } = range as { start: string; end: string };
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      throw new BadRequestException(
        `schedule.${day} start/end must be "HH:mm" 24-hour times.`
      );
    }
    if (toMinutes(start) >= toMinutes(end)) {
      throw new BadRequestException(
        `schedule.${day} start must be before end.`
      );
    }
    result[day] = { start, end };
  }

  return result;
}

/**
 * True if `now` falls within one of the schedule's day ranges, evaluated in
 * `timezone` (an IANA name, e.g. "America/Bogota"). Informational only — does
 * not gate assignment, just drives display + assign-modal sort order.
 */
export function isWithinSchedule(
  schedule: WeeklySchedule | null | undefined,
  timezone: string,
  now: Date = new Date()
): boolean {
  if (!schedule) return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const weekday = parts
    .find((p) => p.type === 'weekday')
    ?.value.toUpperCase() as Weekday | undefined;
  const hour = parts.find((p) => p.type === 'hour')?.value;
  const minute = parts.find((p) => p.type === 'minute')?.value;
  if (!weekday || hour === undefined || minute === undefined) return false;

  const range = schedule[weekday];
  if (!range) return false;

  // Intl can format midnight as "24:00" for hour12: false — normalize it.
  const nowMinutes = (Number(hour) % 24) * 60 + Number(minute);
  return (
    nowMinutes >= toMinutes(range.start) && nowMinutes < toMinutes(range.end)
  );
}
