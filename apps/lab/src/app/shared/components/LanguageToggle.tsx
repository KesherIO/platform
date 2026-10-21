import { useTranslation } from 'react-i18next';
import { setLanguage, type Language } from '../../i18n/i18n';

const LANGUAGES: Language[] = ['en', 'es'];

/** Compact EN/ES switch for users without access to Settings (everyone except admins/owners). */
export function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const current = i18n.language?.startsWith('es') ? 'es' : 'en';

  return (
    <div
      role="group"
      aria-label={t('settings.language_title')}
      className="inline-flex items-center gap-0.5 rounded-full border border-gray-700 bg-gray-800/60 p-0.5 text-[11px] font-semibold"
    >
      {LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => setLanguage(lng)}
          aria-pressed={current === lng}
          className={`min-w-9 rounded-full px-2.5 py-1 uppercase transition ${
            current === lng
              ? 'bg-cyan/20 text-cyan shadow-sm'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          {lng}
        </button>
      ))}
    </div>
  );
}
