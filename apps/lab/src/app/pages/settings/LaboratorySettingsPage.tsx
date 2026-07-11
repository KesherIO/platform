import { useEffect, useState, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { labApi } from '../../shared/api/labApi';
import type { LaboratoryProfile } from '../../types/lab.types';

const EMPTY_PROFILE: LaboratoryProfile = {
  accreditationNumber: '',
  directorName: '',
  directorCredentials: '',
  defaultObservations: '',
  signatureUrl: '',
};

export function LaboratorySettingsPage() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<LaboratoryProfile>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    labApi.settings.getProfile().then((data) => {
      if (data) setProfile(data as LaboratoryProfile);
      setLoading(false);
    });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await labApi.settings.updateProfile(
        profile as unknown as Record<string, unknown>
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: keyof LaboratoryProfile,
    multiline = false
  ) => (
    <div key={key}>
      <label className="mb-1 block text-sm font-medium text-gray-300">
        {label}
      </label>
      {multiline ? (
        <textarea
          rows={3}
          value={(profile[key] as string) ?? ''}
          onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-cyan focus:outline-none"
        />
      ) : (
        <input
          type="text"
          value={(profile[key] as string) ?? ''}
          onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-cyan focus:outline-none"
        />
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-bold text-white">
        {t('settings.title')}
      </h1>

      <form onSubmit={handleSubmit} className="max-w-lg space-y-5">
        {field(t('settings.accreditation_number'), 'accreditationNumber')}
        {field(t('settings.director_name'), 'directorName')}
        {field(t('settings.director_credentials'), 'directorCredentials', true)}
        {field(t('settings.default_observations'), 'defaultObservations', true)}
        {field(t('settings.signature_url'), 'signatureUrl')}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-cyan px-6 py-2.5 font-semibold text-gray-950 hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
          {saved && (
            <span className="text-sm text-green-400">{t('common.saved')}</span>
          )}
        </div>
      </form>
    </div>
  );
}
