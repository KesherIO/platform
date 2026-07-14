import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabase';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('auth.password_mismatch'));
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      setSuccess(true);
      setTimeout(() => navigate('/orders', { replace: true }), 1500);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">
            {t('auth.set_password_title')}
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            {t('auth.set_password_body')}
          </p>
        </div>

        {success ? (
          <div className="rounded-lg bg-cyan/10 px-4 py-3 text-sm text-cyan">
            {t('auth.password_updated')}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="mb-1 block text-sm text-gray-300"
                htmlFor="new-password"
              >
                {t('auth.new_password')}
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-white placeholder-gray-500 focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
              />
            </div>

            <div>
              <label
                className="mb-1 block text-sm text-gray-300"
                htmlFor="confirm-password"
              >
                {t('auth.confirm_password')}
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-white placeholder-gray-500 focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-900/40 px-4 py-2 text-sm text-red-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-cyan px-4 py-2.5 font-semibold text-gray-950 transition hover:opacity-90 disabled:opacity-50"
            >
              {loading
                ? t('auth.updating_password')
                : t('auth.set_password_button')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
