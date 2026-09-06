import { useTranslation } from 'react-i18next';

export function AuthBranding() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center">
      <img
        src="/kesherio-icon.svg"
        alt="Kesher IO"
        className="h-28 w-28 mb-3.5"
      />
      <span className="text-[22px] font-semibold text-white">
        {t('brand.lab_portal')}
      </span>
      <span className="text-[13px] text-gray-500 mt-1">
        {t('brand.powered_by')}
      </span>
    </div>
  );
}
