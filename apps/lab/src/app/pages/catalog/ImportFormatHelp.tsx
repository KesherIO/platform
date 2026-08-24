import { useTranslation } from 'react-i18next';
import { InfoPopover } from '../../shared/components/InfoPopover';

export function ImportFormatHelp() {
  const { t } = useTranslation();
  const fields = t('catalog.import_file.format_fields', {
    returnObjects: true,
  }) as string[];

  return (
    <InfoPopover label={t('catalog.import_file.format_label')}>
      <p className="mb-2 text-xs font-semibold text-white">
        {t('catalog.import_file.format_title')}
      </p>

      <p className="mb-1.5 text-xs font-medium text-cyan">CSV</p>
      <div className="mb-3 rounded-lg bg-gray-800 p-2">
        <pre className="overflow-x-auto text-[10px] text-gray-300">
{`kind,code,name,category,turnaroundHours,resultType,unit,description,componentCodes
TEST,CBC-001,CBC,Hematology,4,NUMERIC,cells/uL,,
PACKAGE,PKG-001,Wellness,,,,,,CBC-001;CHEM-001`}
        </pre>
      </div>

      <p className="mb-1.5 text-xs font-medium text-cyan">JSON</p>
      <div className="mb-3 rounded-lg bg-gray-800 p-2">
        <pre className="overflow-x-auto text-[10px] text-gray-300">
{`{
  "items": [
    {
      "kind": "TEST",
      "name": "CBC",
      "code": "CBC-001"
    }
  ]
}`}
        </pre>
      </div>

      <p className="mb-1 text-[10px] font-semibold text-gray-300">
        {t('catalog.import_file.format_columns')}
      </p>
      <ul className="space-y-1 text-xs text-gray-400">
        {fields.map((field, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="text-cyan">-</span>
            <span>{field}</span>
          </li>
        ))}
      </ul>
    </InfoPopover>
  );
}
