import { useTranslation } from 'react-i18next';
import { AlertTriangle, Pencil, Scissors } from 'lucide-react';
import type { InstrumentMessageSummary } from '../../types/lab.types';

/**
 * The OBX-13 flags are shown as separate badges on purpose: an expired reagent is a quality
 * problem that blocks import; values edited on the analyzer are retained and visible.
 */
export function InstrumentFlagBadges({ m }: { m: Pick<InstrumentMessageSummary, 'hasExpiredReagent' | 'hasAnalyzerEdits' | 'isComplete'> }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {!m.isComplete && (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-300">
          <Scissors size={12} /> {t('instruments.badge.incomplete')}
        </span>
      )}
      {m.hasExpiredReagent && (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-300">
          <AlertTriangle size={12} /> {t('instruments.badge.expired_reagent')}
        </span>
      )}
      {m.hasAnalyzerEdits && (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-300">
          <Pencil size={12} /> {t('instruments.badge.edited')}
        </span>
      )}
    </span>
  );
}
