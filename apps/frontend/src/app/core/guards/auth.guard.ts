import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { switchMap, of, map, catchError } from 'rxjs';

/**
 * Protects routes that require the user to be authenticated.
 * Waits for the Supabase session to be restored from storage before checking,
 * preventing spurious redirects on hard refresh.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.sessionReady$.pipe(
    switchMap(() => {
      // Not logged in → go to login.
      if (!auth.isLoggedIn()) {
        router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
        return of(false);
      }

      // Session exists but me hasn't been loaded yet → load it now.
      // If loadMe() fails (expired token), redirect to login.
      if (!auth.me()) {
        return auth.loadMe().pipe(
          map(() => true),
          catchError(() => {
            auth.signOut().subscribe();
            router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
            return of(false as const);
          }),
        );
      }

      return of(true);
    }),
  );
};

/**
 * Redirects already-logged-in users away from /auth/login.
 * Waits for the Supabase session to be restored before checking.
 * If the stored session is expired/invalid, signs out silently and lets the user through.
 */
export const noAuthGuard: CanActivateFn = (_route, _state) => {
  const auth = inject(AuthService);

  return auth.sessionReady$.pipe(
    switchMap(() => {
      if (!auth.isLoggedIn()) {
        return of(true);
      }

      // Session exists — verify it's still valid by loading /api/auth/me.
      if (auth.me()) {
        auth.navigateAfterAuth();
        return of(false);
      }

      return auth.loadMe().pipe(
        map(() => {
          auth.navigateAfterAuth();
          return false as const;
        }),
        catchError(() => {
          // Session token is expired or invalid — sign out silently and show login.
          auth.signOut().subscribe();
          return of(true as const);
        }),
      );
    }),
  );
};