import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface Phrase {
  code: string;
  label: string;
  text: string;
  sectionCode?: string;
}

interface ObservationPhrasesPickerProps {
  phrases: Phrase[];
  onInsert: (text: string) => void;
  disabled?: boolean;
}

export function ObservationPhrasesPicker({
  phrases,
  onInsert,
  disabled,
}: ObservationPhrasesPickerProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (!phrases.length) return null;

  const grouped = new Map<string, Phrase[]>();
  for (const p of phrases) {
    const key = p.sectionCode || '';
    const list = grouped.get(key) ?? [];
    list.push(p);
    grouped.set(key, list);
  }

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-gray-400 transition hover:text-white"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {t('result_entry.quick_phrases')}
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {Array.from(grouped.entries()).map(([group, items]) => (
            <div key={group || '__general'} className="flex flex-wrap gap-1.5">
              {items.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  disabled={disabled}
                  onClick={() => onInsert(p.text)}
                  title={p.text}
                  className="rounded-full border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-300 transition hover:border-cyan hover:text-white disabled:opacity-50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
