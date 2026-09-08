import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthBranding } from '../../auth/AuthBranding';
import type { VerifyLabTokenResponse } from '../../types/lab.types';

export function LabOnboardingWelcome() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const token = searchParams.get('token');
  const [loading, setLoading] = useState(true);
  const [labName, setLabName] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setErrorKey('no_token');
      setLoading(false);
      return;
    }

    fetch(`/api/onboarding/verify/${token}`)
      .then((res) => res.json())
      .then((data: VerifyLabTokenResponse) => {
        if (data.valid) {
          setLabName(data.labName ?? '');
        } else {
          setErrorKey(data.reason ?? 'not_found');
        }
      })
      .catch(() => {
        setErrorKey('not_found');
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
      </div>
    );
  }

  if (errorKey) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-8">
            <AuthBranding />
          </div>
          <div className="rounded-lg bg-red-900/40 px-6 py-5">
            <h2 className="text-lg font-semibold text-red-300">
              {t(`onboarding.error_${errorKey}_title`)}
            </h2>
            <p className="mt-2 text-sm text-red-200">
              {t(`onboarding.error_${errorKey}_body`)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-8">
          <AuthBranding />
        </div>
        <h1 className="text-2xl font-bold text-white">
          {t('onboarding.welcome_title')}
        </h1>
        <p
          className="mt-3 text-gray-400"
          dangerouslySetInnerHTML={{
            __html: t('onboarding.welcome_subtitle', { labName }),
          }}
        />
        <button
          onClick={() => navigate(`/onboarding/setup?token=${token}`)}
          className="mt-8 w-full rounded-lg bg-cyan px-4 py-2.5 font-semibold text-gray-950 transition hover:opacity-90"
        >
          {t('onboarding.continue')}
        </button>
      </div>
    </div>
  );
}
