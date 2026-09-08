import { useState, useEffect, FormEvent } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthBranding } from '../../auth/AuthBranding';
import type {
  VerifyLabTokenResponse,
  CompleteLabOnboardingRequest,
  CompleteLabOnboardingResponse,
} from '../../types/lab.types';

export function LabOnboardingSetup() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const token = searchParams.get('token');
  const [verifying, setVerifying] = useState(true);

  const [labName, setLabName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }

    fetch(`/api/onboarding/verify/${token}`)
      .then((res) => res.json())
      .then((data: VerifyLabTokenResponse) => {
        if (data.valid) {
          setLabName(data.labName ?? '');
        } else {
          navigate(`/onboarding/welcome?token=${token}`, { replace: true });
        }
      })
      .catch(() => {
        navigate(`/onboarding/welcome?token=${token}`, { replace: true });
      })
      .finally(() => setVerifying(false));
  }, [token, navigate]);

  const passwordsMatch = password === confirmPassword;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordsMatch || !token) return;

    setError(null);
    setSubmitting(true);

    const body: CompleteLabOnboardingRequest = {
      token,
      adminFirstName: firstName,
      adminLastName: lastName,
      adminEmail: email,
      password,
      labName,
    };

    try {
      const res = await fetch('/api/onboarding/complete-lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? t('onboarding.error_generic'));
      }

      await res.json() as CompleteLabOnboardingResponse;
      setCompleted(true);
      window.history.replaceState({}, '', '/onboarding/setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.error_generic'));
    } finally {
      setSubmitting(false);
    }
  };

  if (verifying) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
      </div>
    );
  }

  if (completed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-8">
            <AuthBranding />
          </div>
          <div className="rounded-lg bg-cyan/10 px-6 py-5">
            <h2 className="text-lg font-semibold text-cyan">
              {t('onboarding.success_title')}
            </h2>
            <p className="mt-2 text-sm text-gray-300">
              {t('onboarding.success_message')}
            </p>
          </div>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="mt-6 w-full rounded-lg bg-cyan px-4 py-2.5 font-semibold text-gray-950 transition hover:opacity-90"
          >
            {t('onboarding.go_to_login')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4">
            <AuthBranding />
          </div>
          <h1 className="text-2xl font-bold text-white">
            {t('onboarding.setup_title')}
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            {t('onboarding.setup_subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-300" htmlFor="labName">
              {t('onboarding.lab_name')}
            </label>
            <input
              id="labName"
              type="text"
              required
              minLength={2}
              value={labName}
              onChange={(e) => setLabName(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-white placeholder-gray-500 focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-gray-300" htmlFor="firstName">
                {t('onboarding.first_name')}
              </label>
              <input
                id="firstName"
                type="text"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-white placeholder-gray-500 focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-300" htmlFor="lastName">
                {t('onboarding.last_name')}
              </label>
              <input
                id="lastName"
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-white placeholder-gray-500 focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-300" htmlFor="email">
              {t('onboarding.email')}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-white placeholder-gray-500 focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-300" htmlFor="password">
              {t('onboarding.password')}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 pr-10 text-white placeholder-gray-500 focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white"
              >
                <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-sm`} />
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">{t('onboarding.password_hint')}</p>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-300" htmlFor="confirmPassword">
              {t('onboarding.confirm_password')}
            </label>
            <input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-white placeholder-gray-500 focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
            />
            {confirmPassword && !passwordsMatch && (
              <p className="mt-1 text-xs text-red-400">{t('onboarding.password_mismatch')}</p>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-red-900/40 px-4 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !passwordsMatch}
            className="w-full rounded-lg bg-cyan px-4 py-2.5 font-semibold text-gray-950 transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? t('onboarding.submitting') : t('onboarding.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
