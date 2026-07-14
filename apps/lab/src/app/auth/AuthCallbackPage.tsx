import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabase';

export function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password', { replace: true });
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-cyan border-t-transparent" />
    </div>
  );
}
