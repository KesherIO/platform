import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { labApi } from '../../shared/api/labApi';
import type { ResultsAnalyte } from '../../types/lab.types';

/**
 * Analyte filter: type to search the analytes seen in this lab's releases,
 * pick one; the chosen analyte shows as a chip that can be cleared.
 */
export function AnalytePicker({
  value,
  onChange,
}: {
  value: ResultsAnalyte | null;
  onChange: (analyte: ResultsAnalyte | null) => void;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const { data: options = [], isFetching } = useQuery({
    queryKey: ['results-analytes', debounced],
    queryFn: () => labApi.results.analytes(debounced || undefined),
    enabled: open,
    staleTime: 60_000,
  });

  if (value) {
    return (
      <div className="flex h-10 items-center gap-2 rounded-lg border border-cyan/40 bg-cyan/10 px-3 text-sm text-cyan">
        <span className="truncate">
          {value.name} <span className="text-cyan/60">({value.code})</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t('results.filters.clear_analyte')}
          className="shrink-0 rounded p-0.5 hover:bg-cyan/20"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <input
        id="results-analyte"
        type="text"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('results.filters.analyte_placeholder')}
        className="h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-white placeholder-gray-500 focus:border-cyan focus:outline-none"
        autoComplete="off"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-lg">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">
              {isFetching
                ? t('common.loading')
                : t('results.filters.no_analytes')}
            </p>
          ) : (
            options.map((a) => (
              <button
                key={a.code}
                type="button"
                onClick={() => {
                  onChange(a);
                  setTerm('');
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800"
              >
                <span className="truncate">{a.name}</span>
                <span className="shrink-0 text-xs text-gray-500">{a.code}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
