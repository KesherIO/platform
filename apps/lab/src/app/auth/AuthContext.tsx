import {
  createContext,
  useContext,
  useEffect,
  useRef,
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
  canPerformPickups: boolean;
  tenantName: string | null;
  logoUrl: string | null;
  accessDenied: boolean;
  refreshTenant: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [labRole, setLabRole] = useState<LabRole | null>(null);
  const [canPerformPickupsFlag, setCanPerformPickupsFlag] = useState(false);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const currentUserIdRef = useRef<string | null>(null);

  // Account has no LAB/PLATFORM tenant membership — the lab portal is not
  // for clinic users. Clear the session immediately (don't wait on the
  // network signOut() call) so ProtectedRoute/LoginPage never treat this
  // account as logged in, even for one render.
  const denyLabAccess = () => {
    setAccessDenied(true);
    setSession(null);
    setLabRole(null);
    setCanPerformPickupsFlag(false);
    setTenantName(null);
    setLogoUrl(null);
    void supabase.auth.signOut();
  };

  const fetchLabRole = async (accessToken: string) => {
    try {
      const res = await fetch('/api/lab/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 403) {
        denyLabAccess();
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setAccessDenied(false);
      setLabRole(data.role as LabRole);
      setCanPerformPickupsFlag(data.canPerformPickups ?? false);
      setTenantName(data.tenantName ?? null);
      setLogoUrl(data.logoUrl ?? null);
    } catch {
      // network error — role stays null, UI defaults to non-admin
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.access_token) {
        currentUserIdRef.current = data.session.user.id;
        await fetchLabRole(data.session.access_token);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        const newUserId = s?.user?.id ?? null;
        const isSameUser =
          newUserId != null && newUserId === currentUserIdRef.current;

        if (isSameUser && event !== 'SIGNED_OUT') {
          setSession(s);
          return;
        }

        setLoading(true);
        setSession(s);
        currentUserIdRef.current = newUserId;
        if (s?.access_token) {
          await fetchLabRole(s.access_token);
        } else {
          setLabRole(null);
          setCanPerformPickupsFlag(false);
          setTenantName(null);
          setLogoUrl(null);
        }
        setLoading(false);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshTenant = async () => {
    if (session?.access_token) {
      await fetchLabRole(session.access_token);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        labRole,
        isAdmin: labRole === 'ADMIN',
        canPerformPickups: labRole === 'MESSENGER' || canPerformPickupsFlag,
        tenantName,
        logoUrl,
        accessDenied,
        refreshTenant,
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
