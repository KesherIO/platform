import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { createClient, SupabaseClient, Session, AuthError } from '@supabase/supabase-js';
import { Observable, from, of, switchMap, tap, map, shareReplay, catchError } from 'rxjs';
import { environment } from '../../../environments/environment';

// Captured at module-load time, before the Supabase SDK initialises and clears the hash.
const initialHash = window.location.hash;

export interface MeResponse {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    createdAt: string;
  };
  memberships: Array<{
    role: string;
    createdAt: string;
    tenant: {
      id: string;
      name: string;
      slug: string;
      logoUrl: string | null;
      primaryColor: string | null;
    };
  }>;
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string | null;
  }>;
  onboardingCompleted: boolean;
  activeTenantId: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly supabase: SupabaseClient = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
  );

  /** Current Supabase session — null when logged out. */
  readonly session = signal<Session | null>(null);

  /** Result of GET /api/auth/me — populated after login. */
  readonly me = signal<MeResponse | null>(null);

  /**
   * Resolves once the initial Supabase session has been restored from storage.
   * Guards should wait for this before checking isLoggedIn(), otherwise they
   * may see session=null on a hard refresh before getSession() has resolved.
   */
  readonly sessionReady$: Observable<void> = from(
    this.supabase.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
    }),
  ).pipe(shareReplay(1));

  /**
   * Set to true when Supabase fires PASSWORD_RECOVERY, which can happen
   * during app initialisation — before CallbackComponent even mounts.
   * handleAuthCallback() reads and clears this flag so it works regardless
   * of whether the event fired before or after the component registered its
   * own onAuthStateChange listener.
   */
  private _pendingRecovery = false;

  constructor() {
    // Eagerly subscribe so the promise is kicked off immediately.
    this.sessionReady$.subscribe();

    // Keep the session signal in sync and capture recovery events early.
    this.supabase.auth.onAuthStateChange((event, session) => {
      this.session.set(session);
      if (event === 'PASSWORD_RECOVERY') {
        this._pendingRecovery = true;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Current JWT access token, or null. */
  getAccessToken(): string | null {
    return this.session()?.access_token ?? null;
  }

  isLoggedIn(): boolean {
    return this.session() !== null;
  }

  // ---------------------------------------------------------------------------
  // Auth flows
  // ---------------------------------------------------------------------------

  /**
   * Sign in with email + password.
   * After login, fetches /api/auth/me and routes to onboarding or dashboard.
   */
  signInWithPassword(email: string, password: string): Observable<void> {
    return from(this.supabase.auth.signInWithPassword({ email, password })).pipe(
      switchMap(({ error }) => {
        if (error) throw error;
        return this.loadMe();
      }),
      tap(() => this.navigateAfterAuth()),
      map(() => undefined as void),
    );
  }

  /**
   * Sign up with email + password.
   * Supabase may require email confirmation depending on project settings.
   */
  signUp(email: string, password: string): Observable<{ needsConfirmation: boolean }> {
    return from(this.supabase.auth.signUp({ email, password })).pipe(
      switchMap(({ data, error }) => {
        if (error) throw error;
        // If user is already confirmed (e.g. email confirmation disabled), log them in.
        if (data.session) {
          this.session.set(data.session);
          return this.loadMe().pipe(
            tap(() => this.navigateAfterAuth()),
            map(() => ({ needsConfirmation: false as const })),
          );
        }
        // Email confirmation required — user needs to check their inbox.
        return of({ needsConfirmation: true as const });
      }),
    );
  }

  /**
   * Send a password reset email via Supabase.
   */
  resetPassword(email: string): Observable<void> {
    return from(
      this.supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      }),
    ).pipe(
      switchMap(({ error }) => {
        if (error) throw error;
        return of(undefined as void);
      }),
    );
  }

  /**
   * Send a magic-link sign-in email.
   */
  sendMagicLink(email: string): Observable<void> {
    return from(
      this.supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      }),
    ).pipe(
      switchMap(({ error }) => {
        if (error) throw error;
        return of(undefined as void);
      }),
    );
  }

  /**
   * Exchange the auth code from the URL hash/query after an OTP / magic-link redirect.
   * Returns 'recovery' when the link is a password-reset (type=recovery in hash),
   * so the caller can show a set-new-password form instead of navigating away.
   * Call this from the /auth/callback route.
   */
  handleAuthCallback(): Observable<'recovery' | 'authenticated'> {
    // Check for Supabase error in the URL hash (e.g. expired or already-used link).
    const hashParams = new URLSearchParams(initialHash.slice(1));
    const hashError = hashParams.get('error_description') ?? hashParams.get('error');
    if (hashError) {
      return new Observable(observer => observer.error(new Error(decodeURIComponent(hashError.replace(/\+/g, ' ')))));
    }

    // PASSWORD_RECOVERY may have fired during app init, before this component mounted.
    if (this._pendingRecovery) {
      this._pendingRecovery = false;
      return of('recovery' as const);
    }

    // Fallback: hash-based detection for implicit flow (type=recovery in hash fragment).
    const isRecovery = hashParams.get('type') === 'recovery';

    return new Observable<'recovery' | 'authenticated'>(observer => {
      let done = false;

      const { data: { subscription } } = this.supabase.auth.onAuthStateChange((event, session) => {
        if (done) return;

        if (event === 'PASSWORD_RECOVERY') {
          done = true;
          this.session.set(session);
          observer.next('recovery');
          observer.complete();
        } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
          done = true;
          this.session.set(session);
          if (isRecovery) {
            observer.next('recovery');
            observer.complete();
          } else {
            this.loadMe().pipe(tap(() => this.navigateAfterAuth())).subscribe({
              next: () => { observer.next('authenticated'); observer.complete(); },
              error: (err) => observer.error(err),
            });
          }
        }
      });

      return () => subscription.unsubscribe();
    });
  }

  /**
   * Update the authenticated user's password.
   * Call this after handleAuthCallback() returns 'recovery'.
   */
  updatePassword(newPassword: string): Observable<void> {
    return from(this.supabase.auth.updateUser({ password: newPassword })).pipe(
      switchMap(({ error }) => {
        if (error) throw error;
        return this.loadMe().pipe(
          tap(() => this.navigateAfterAuth()),
          map(() => undefined as void),
        );
      }),
    );
  }

  /**
   * Sign out — invalidates the session server-side, then clears local state.
   * The backend call is best-effort: if it fails (e.g. token already expired)
   * we still clear locally and navigate to login.
   */
  signOut(): Observable<void> {
    return this.http.post('/api/auth/sign-out', {}).pipe(
      catchError(() => of(null)), // non-fatal — proceed with client-side sign-out
      switchMap(() => from(this.supabase.auth.signOut())),
      switchMap(({ error }: { error: AuthError | null }) => {
        this.session.set(null);
        this.me.set(null);
        this.router.navigate(['/auth/login']);
        if (error) throw error;
        return of(undefined as void);
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // /api/auth/me
  // ---------------------------------------------------------------------------

  /**
   * Fetch the current user profile from our API.
   * The AuthInterceptor will attach the Bearer token automatically.
   */
  loadMe(): Observable<MeResponse> {
    return this.http.get<MeResponse>('/api/auth/me').pipe(
      tap((me) => this.me.set(me)),
    );
  }

  // ---------------------------------------------------------------------------
  // Routing helper
  // ---------------------------------------------------------------------------

  navigateAfterAuth(): void {
    const meData = this.me();
    if (!meData) return;

    if (!meData.onboardingCompleted) {
      this.router.navigate(['/onboarding/welcome']);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}