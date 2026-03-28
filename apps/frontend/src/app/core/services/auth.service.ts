import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { createClient, SupabaseClient, Session, AuthError } from '@supabase/supabase-js';
import { Observable, from, of, switchMap, tap, map, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';

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

  constructor() {
    // Eagerly subscribe so the promise is kicked off immediately.
    this.sessionReady$.subscribe();

    // Keep the signal in sync with Supabase auth state changes.
    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
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
   * Call this from the /auth/callback route.
   */
  handleAuthCallback(): Observable<void> {
    return from(this.supabase.auth.getSession()).pipe(
      switchMap(({ data, error }) => {
        if (error) throw error;
        if (data.session) {
          this.session.set(data.session);
          return this.loadMe().pipe(
            tap(() => this.navigateAfterAuth()),
            map(() => undefined as void),
          );
        }
        return of(undefined as void);
      }),
    );
  }

  /**
   * Sign out — clears local session and navigates to /auth/login.
   */
  signOut(): Observable<void> {
    return from(this.supabase.auth.signOut()).pipe(
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