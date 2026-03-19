import { Routes } from '@angular/router';
import { onboardingGuard } from './core/guards/onboarding.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/cases',
    pathMatch: 'full'
  },
  {
    path: 'onboarding',
    loadChildren: () => import('./features/onboarding/onboarding.routes').then(m => m.ONBOARDING_ROUTES),
    canActivate: [onboardingGuard]
  },
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES)
  },
  {
    path: 'cases',
    loadChildren: () => import('./features/cases/cases.routes').then(m => m.CASES_ROUTES)
  },
  {
    path: '**',
    redirectTo: '/cases'
  }
];

