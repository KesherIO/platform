import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, X } from 'lucide-react';

interface DateRangeFilterProps {
  dateFrom: string;
  dateTo: string;
  onChange: (range: { dateFrom: string; dateTo: string }) => void;
  label: string;
  className?: string;
}

function formatShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Aug 1–8" for a same-month range, "Aug 1 – Sep 3" otherwise, "…" for an
 * open-ended bound. Dates parse as UTC midnight, so every part is read back
 * in UTC too — otherwise a negative-offset browser timezone can display the
 * wrong day. */
function formatRangeSummary(dateFrom: string, dateTo: string): string {
  if (dateFrom && dateTo) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const sameMonth =
      from.getUTCFullYear() === to.getUTCFullYear() &&
      from.getUTCMonth() === to.getUTCMonth();
    if (sameMonth) {
      const month = from.toLocaleDateString(undefined, {
        month: 'short',
        timeZone: 'UTC',
      });
      return `${month} ${from.getUTCDate()}–${to.getUTCDate()}`;
    }
    return `${formatShort(dateFrom)} – ${formatShort(dateTo)}`;
  }
  if (dateFrom) return `${formatShort(dateFrom)} – …`;
  return `… – ${formatShort(dateTo)}`;
}

/** Compact toolbar control that opens a popover with From/To date inputs —
 * keeps native <input type="date"> for accessibility/keyboard nav instead of
 * pulling in a calendar-widget dependency. When a range is active it shows
 * the range itself instead of the generic label, plus an inline × to clear
 * just the date filter without opening the popover. */
export function DateRangeFilter({
  dateFrom,
  dateTo,
  onChange,
  label,
  className = '',
}: DateRangeFilterProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(dateFrom);
  const [draftTo, setDraftTo] = useState(dateTo);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setDraftFrom(dateFrom);
      setDraftTo(dateTo);
    }
  }, [open, dateFrom, dateTo]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const hasValue = Boolean(dateFrom || dateTo);

  const apply = () => {
    onChange({ dateFrom: draftFrom, dateTo: draftTo });
    setOpen(false);
  };

  const clear = () => {
    setDraftFrom('');
    setDraftTo('');
    onChange({ dateFrom: '', dateTo: '' });
    setOpen(false);
  };

  const clearInline = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftFrom('');
    setDraftTo('');
    onChange({ dateFrom: '', dateTo: '' });
    setOpen(false);
  };

  return (
    <div
      className={`relative flex h-9 items-center rounded-lg border text-sm font-medium transition ${
        hasValue
          ? 'border-cyan/30 bg-cyan/10 text-cyan'
          : 'border-gray-700 bg-gray-900 text-gray-300'
      } ${className}`}
      ref={containerRef}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-full items-center gap-1.5 rounded-lg px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 ${
          hasValue ? 'hover:opacity-90' : 'hover:bg-gray-800 hover:text-white'
        }`}
      >
        <Calendar size={14} />
        {hasValue ? formatRangeSummary(dateFrom, dateTo) : label}
      </button>

      {hasValue && (
        <button
          type="button"
          onClick={clearInline}
          aria-label={t('common.clear_date_range')}
          className="mr-1.5 rounded p-0.5 hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
        >
          <X size={13} />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-lg"
        >
          <div className="flex flex-col gap-2">
            <label className="text-xs text-gray-400">
              {t('common.date_from')}
              <input
                type="date"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-gray-700 bg-gray-950 px-2 text-sm text-white focus:border-cyan focus:outline-none"
              />
            </label>
            <label className="text-xs text-gray-400">
              {t('common.date_to')}
              <input
                type="date"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-gray-700 bg-gray-950 px-2 text-sm text-white focus:border-cyan focus:outline-none"
              />
            </label>
            <div className="mt-1 flex items-center justify-between">
              <button
                type="button"
                onClick={clear}
                className="text-xs text-gray-400 hover:text-white"
              >
                {t('common.clear')}
              </button>
              <button
                type="button"
                onClick={apply}
                className="rounded-lg bg-cyan px-3 py-1.5 text-xs font-semibold text-gray-950 hover:opacity-90"
              >
                {t('common.apply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
