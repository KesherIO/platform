import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { TenantService } from '../services/tenant.service';
import { switchMap, of, map, catchError } from 'rxjs';

function resolveAccess(
  auth: AuthService,
  tenant: TenantService,
  router: Router
): boolean {
  if (!auth.me()?.memberships?.length) {
    router.navigate(['/no-clinic']);
    return false;
  }

  if (tenant.needsClinicSelection()) {
    router.navigate(['/select-clinic']);
    return false;
  }

  const membership = tenant.activeMembership();
  if (!membership) {
    router.navigate(['/select-clinic']);
    return false;
  }

  switch (membership.status) {
    case 'PROFILE_REQUIRED':
      router.navigate(['/onboarding/vet-profile']);
      return false;
    case 'VERIFICATION_PENDING':
      if (membership.vetVerification?.status === 'REJECTED') {
        router.navigate(['/onboarding/verification-rejected']);
      } else {
        router.navigate(['/onboarding/verification-pending']);
      }
      return false;
    default:
      return true;
  }
}

/**
 * Protects routes that require the user to be authenticated.
 * Waits for the Supabase session to be restored from storage before checking,
 * preventing spurious redirects on hard refresh.
 * Also blocks PROFILE_REQUIRED and VERIFICATION_PENDING users from protected routes.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const tenant = inject(TenantService);
  const router = inject(Router);

  return auth.sessionReady$.pipe(
    switchMap(() => {
      // Not logged in → go to login.
      if (!auth.isLoggedIn()) {
        router.navigate(['/auth/login'], {
          queryParams: { returnUrl: state.url },
        });
        return of(false);
      }

      // Session exists but me hasn't been loaded yet → load it now.
      // If loadMe() fails (expired token), redirect to login.
      if (!auth.me()) {
        return auth.loadMe().pipe(
          map(() => resolveAccess(auth, tenant, router)),
          catchError(() => {
            auth.signOut().subscribe();
            router.navigate(['/auth/login'], {
              queryParams: { returnUrl: state.url },
            });
            return of(false as const);
          })
        );
      }

      return of(resolveAccess(auth, tenant, router));
    })
  );
};

/**
 * Lightweight guard that only checks authentication — no membership or tenant checks.
 * Used for routes like /select-clinic that need a logged-in user but must not
 * redirect based on tenant state (which would loop).
 */
export const authOnlyGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.sessionReady$.pipe(
    switchMap(() => {
      if (!auth.isLoggedIn()) {
        router.navigate(['/auth/login'], {
          queryParams: { returnUrl: state.url },
        });
        return of(false);
      }

      if (!auth.me()) {
        return auth.loadMe().pipe(
          map(() => true),
          catchError(() => {
            auth.signOut().subscribe();
            router.navigate(['/auth/login'], {
              queryParams: { returnUrl: state.url },
            });
            return of(false as const);
          })
        );
      }

      return of(true);
    })
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

      // Session exists — always reload /api/auth/me so navigateAfterAuth() sees
      // the latest membership status (not a stale signal from a previous login).
      // This matters for the re-invite flow: an existing user who just joined a
      // new clinic via magic link must be routed with their fresh membership data.
      return auth.loadMe().pipe(
        map(() => {
          auth.navigateAfterAuth();
          return false as const;
        }),
        catchError(() => {
          // Session token is expired or invalid — sign out silently and show login.
          auth.signOut().subscribe();
          return of(true as const);
        })
      );
    })
  );
};
