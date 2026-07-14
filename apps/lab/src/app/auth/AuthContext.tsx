import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { LabRole } from '../types/lab.types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  labRole: LabRole | null;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [labRole, setLabRole] = useState<LabRole | null>(null);

  const fetchLabRole = async (accessToken: string) => {
    try {
      const res = await fetch('/api/lab/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setLabRole(data.role as LabRole);
    } catch {
      // role stays null — UI defaults to non-admin
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.access_token) {
        await fetchLabRole(data.session.access_token);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        setSession(s);
        if (s?.access_token) {
          await fetchLabRole(s.access_token);
        } else {
          setLabRole(null);
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        labRole,
        isAdmin: labRole === 'ADMIN',
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
