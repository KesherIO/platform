import { useTranslation } from 'react-i18next';
import { InfoPopover } from '../../shared/components/InfoPopover';

export function CatalogGuidelines() {
  const { t } = useTranslation();
  const items = t('catalog.guidelines.items', {
    returnObjects: true,
  }) as string[];

  return (
    <InfoPopover label={t('catalog.guidelines.label')}>
      <p className="mb-2 text-xs font-semibold text-white">
        {t('catalog.guidelines.title')}
      </p>
      <ul className="space-y-1.5 text-xs text-gray-400">
        {items.map((item, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-cyan">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </InfoPopover>
  );
}
