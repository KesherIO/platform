import { Routes } from '@angular/router';
import {
  authGuard,
  noAuthGuard,
  authOnlyGuard,
} from './core/guards/auth.guard';

export const routes: Routes = [
  // Auth callback must come BEFORE the 'auth' parent route.
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

  // Onboarding — public.
  {
    path: 'onboarding',
    loadChildren: () =>
      import('./features/onboarding/onboarding.routes').then(
        (m) => m.ONBOARDING_ROUTES
      ),
  },

  // No clinic — shown to authenticated users with zero memberships.
  {
    path: 'no-clinic',
    loadComponent: () =>
      import('./features/onboarding/no-clinic/no-clinic.component').then(
        (m) => m.NoClinicComponent
      ),
  },

  // Clinic selection — shown to users with multiple clinics and no saved preference.
  {
    path: 'select-clinic',
    canActivate: [authOnlyGuard],
    loadComponent: () =>
      import('./features/auth/select-clinic/select-clinic.component').then(
        (m) => m.SelectClinicComponent
      ),
  },

  // Authenticated app — wrapped in the responsive shell (sidebar on desktop, bottom nav on mobile).
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shared/components/app-shell/app-shell.component').then(
        (m) => m.AppShellComponent
      ),
    children: [
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then(
            (m) => m.DASHBOARD_ROUTES
          ),
      },
      {
        path: 'cases',
        loadChildren: () =>
          import('./features/cases/cases.routes').then((m) => m.CASES_ROUTES),
      },
      {
        path: 'results',
        loadComponent: () =>
          import('./features/results/results.component').then(
            (m) => m.ResultsComponent
          ),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import(
            './features/settings/settings-shell/settings-shell.component'
          ).then((m) => m.SettingsShellComponent),
      },
    ],
  },

  // Catch-all.
  {
    path: '**',
    redirectTo: '/dashboard',
  },
];
