import { useTranslation } from 'react-i18next';
import { WEEKDAYS, type WeeklySchedule } from '../../types/lab.types';

export function makeEmptySchedule(): WeeklySchedule {
  return {
    MONDAY: null,
    TUESDAY: null,
    WEDNESDAY: null,
    THURSDAY: null,
    FRIDAY: null,
    SATURDAY: null,
    SUNDAY: null,
  };
}

const DEFAULT_RANGE = { start: '09:00', end: '17:00' };

interface WeeklyScheduleEditorProps {
  value: WeeklySchedule;
  onChange: (value: WeeklySchedule) => void;
  disabled?: boolean;
}

export function WeeklyScheduleEditor({
  value,
  onChange,
  disabled = false,
}: WeeklyScheduleEditorProps) {
  const { t } = useTranslation();

  const toggleDay = (day: (typeof WEEKDAYS)[number]) => {
    onChange({
      ...value,
      [day]: value[day] ? null : DEFAULT_RANGE,
    });
  };

  const updateRange = (
    day: (typeof WEEKDAYS)[number],
    field: 'start' | 'end',
    time: string
  ) => {
    const current = value[day] ?? DEFAULT_RANGE;
    onChange({ ...value, [day]: { ...current, [field]: time } });
  };

  return (
    <div className="space-y-2">
      {WEEKDAYS.map((day) => {
        const range = value[day];
        return (
          <div key={day} className="flex items-center gap-3">
            <label className="flex w-32 shrink-0 items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={range !== null}
                disabled={disabled}
                onChange={() => toggleDay(day)}
                className="h-4 w-4 rounded border-gray-700 bg-gray-800 accent-cyan"
              />
              {t(`team.schedule.days.${day}`)}
            </label>
            <input
              type="time"
              value={range?.start ?? ''}
              disabled={disabled || !range}
              onChange={(e) => updateRange(day, 'start', e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white disabled:opacity-40 focus:border-cyan focus:outline-none"
            />
            <span className="text-xs text-gray-500">
              {t('team.schedule.to')}
            </span>
            <input
              type="time"
              value={range?.end ?? ''}
              disabled={disabled || !range}
              onChange={(e) => updateRange(day, 'end', e.target.value)}
              className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white disabled:opacity-40 focus:border-cyan focus:outline-none"
            />
          </div>
        );
      })}
    </div>
  );
}
