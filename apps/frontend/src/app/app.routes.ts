import { Routes } from '@angular/router';
import { authGuard, noAuthGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  // Root → redirect to dashboard (authGuard will catch unauthenticated users).
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full',
  },

  // Auth callback must come BEFORE the 'auth' parent route.
  // Angular matches routes in order; if 'auth' comes first, its noAuthGuard fires
  // for /auth/callback (treating the recovery session as a normal login) and
  // redirects to dashboard before the component can render the set-password form.
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/callback/callback.component').then(
        (m) => m.CallbackComponent
      ),
  },

  // Auth pages — redirect away if already logged in.
  {
    path: 'auth',
    canActivate: [noAuthGuard],
    loadChildren: () =>
      import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },

  // Onboarding — public. Users arrive here before they have credentials.
  // Access is controlled by the KesherIO-generated tenantId or invite token in the URL.
  {
    path: 'onboarding',
    loadChildren: () =>
      import('./features/onboarding/onboarding.routes').then(
        (m) => m.ONBOARDING_ROUTES
      ),
  },

  // Dashboard and app pages — requires authentication + onboarding complete.
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/dashboard/dashboard.routes').then(
        (m) => m.DASHBOARD_ROUTES
      ),
  },

  {
    path: 'cases',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/cases/cases.routes').then((m) => m.CASES_ROUTES),
  },

  {
    path: 'results',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/results/results.component').then(
        (m) => m.ResultsComponent
      ),
  },

  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import(
        './features/settings/settings-shell/settings-shell.component'
      ).then((m) => m.SettingsShellComponent),
  },

  // Catch-all.
  {
    path: '**',
    redirectTo: '/dashboard',
  },
];
