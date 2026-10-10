import { useTranslation } from 'react-i18next';
import { taxIdTypesForCountry } from '../../shared/taxIdTypes';

interface Props {
  country: string;
  taxIdType: string;
  taxId: string;
  onChange: (changes: { taxIdType?: string; taxId?: string }) => void;
  labelClassName: string;
  inputClassName: string;
}

/**
 * ID type (options depend on the country) + ID number. The API needs both and
 * a country before it accepts a number, so the number stays disabled until
 * then. Callers clear an ID type that no longer fits when the country changes
 * (clearInvalidTaxIdType in shared/taxIdTypes.ts).
 */
export function ClientTaxIdFields({
  country,
  taxIdType,
  taxId,
  onChange,
  labelClassName,
  inputClassName,
}: Props) {
  const { t } = useTranslation();
  const types = taxIdTypesForCountry(country || null);
  const canEnterNumber = !!country && !!taxIdType;

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className={labelClassName}>
          {t('clients.form.tax_id_type')}
        </label>
        <select
          value={taxIdType}
          onChange={(e) => onChange({ taxIdType: e.target.value })}
          className={inputClassName}
        >
          <option value="">{t('clients.form.tax_id_type_placeholder')}</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {t(`clients.tax_id_types.${type}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClassName}>{t('clients.form.tax_id')}</label>
        <input
          value={taxId}
          disabled={!canEnterNumber && !taxId}
          onChange={(e) => onChange({ taxId: e.target.value })}
          placeholder={t('clients.form.tax_id_placeholder')}
          title={canEnterNumber ? undefined : t('clients.form.tax_id_hint')}
          className={`${inputClassName} disabled:opacity-50`}
        />
      </div>
    </div>
  );
}
