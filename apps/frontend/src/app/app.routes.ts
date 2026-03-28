import { Routes } from '@angular/router';
import { authGuard, noAuthGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  // Root → redirect to dashboard (authGuard will catch unauthenticated users).
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full',
  },

  // Auth pages — redirect away if already logged in.
  {
    path: 'auth',
    canActivate: [noAuthGuard],
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES),
  },

  // Auth callback doesn't go through noAuthGuard — Supabase can redirect here
  // before the session is fully established.
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/callback/callback.component').then(m => m.CallbackComponent),
  },

  // Onboarding — public. Users arrive here before they have credentials.
  // Access is controlled by the Biomet-generated tenantId or invite token in the URL.
  {
    path: 'onboarding',
    loadChildren: () =>
      import('./features/onboarding/onboarding.routes').then(m => m.ONBOARDING_ROUTES),
  },

  // Dashboard and app pages — requires authentication + onboarding complete.
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES),
  },

  {
    path: 'cases',
    canActivate: [authGuard],
    loadChildren: () => import('./features/cases/cases.routes').then(m => m.CASES_ROUTES),
  },

  // Catch-all.
  {
    path: '**',
    redirectTo: '/dashboard',
  },
];