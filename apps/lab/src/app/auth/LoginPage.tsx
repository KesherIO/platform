import { useState, FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';

type View = 'login' | 'reset';

export function LoginPage() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (session) return <Navigate to="/orders" replace />;

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (authError) setError(authError.message);
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/auth/callback` }
    );
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
    } else {
      setResetSent(true);
    }
  };

  const showReset = () => {
    setView('reset');
    setError(null);
    setResetSent(false);
  };

  const showLogin = () => {
    setView('login');
    setError(null);
    setResetSent(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">{t('auth.title')}</h1>
          <p className="mt-1 text-sm text-gray-400">{t('auth.subtitle')}</p>
        </div>

        {view === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                className="mb-1 block text-sm text-gray-300"
                htmlFor="email"
              >
                {t('auth.email')}
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
              <label
                className="mb-1 block text-sm text-gray-300"
                htmlFor="password"
              >
                {t('auth.password')}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              {loading ? t('auth.logging_in') : t('auth.login')}
            </button>

            <button
              type="button"
              onClick={showReset}
              className="w-full text-sm text-gray-400 hover:text-white transition"
            >
              {t('auth.forgot_password')}
            </button>
          </form>
        )}

        {view === 'reset' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {t('auth.reset_title')}
              </h2>
              <p className="mt-1 text-sm text-gray-400">
                {t('auth.reset_body')}
              </p>
            </div>

            {resetSent ? (
              <div className="rounded-lg bg-cyan/10 px-4 py-3 text-sm text-cyan">
                {t('auth.reset_sent')}
              </div>
            ) : (
              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <label
                    className="mb-1 block text-sm text-gray-300"
                    htmlFor="reset-email"
                  >
                    {t('auth.email')}
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                  {t('auth.reset_button')}
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={showLogin}
              className="w-full text-sm text-gray-400 hover:text-white transition"
            >
              {t('auth.back_to_login')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
