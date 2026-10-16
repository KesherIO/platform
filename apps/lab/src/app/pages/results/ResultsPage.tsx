import { useTranslation } from 'react-i18next';

/**
 * Resultados — released results search (docs/RESULTS_SEARCH_PLAN.md).
 * Placeholder until the search lands; "Consulta" users are routed here.
 */
export function ResultsPage() {
  const { t } = useTranslation();
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-white">{t('results.title')}</h1>
      <p className="mt-2 text-sm text-gray-400">{t('results.coming_soon')}</p>
    </div>
  );
}
