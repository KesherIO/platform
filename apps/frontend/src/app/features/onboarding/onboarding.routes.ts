import { Routes } from '@angular/router';

export const ONBOARDING_ROUTES: Routes = [
  {
    path: 'welcome',
    loadComponent: () =>
      import('./welcome/welcome.component').then((m) => m.WelcomeComponent),
  },
  {
    path: 'clinic-setup',
    loadComponent: () =>
      import('./clinic-setup/clinic-setup.component').then(
        (m) => m.ClinicSetupComponent
      ),
  },
  {
    path: 'admin-profile',
    loadComponent: () =>
      import('./admin-profile/admin-profile.component').then(
        (m) => m.AdminProfileComponent
      ),
  },
  {
    path: 'staff',
    loadComponent: () =>
      import('./staff-profile/staff-profile.component').then(
        (m) => m.StaffProfileComponent
      ),
  },
  {
    path: 'vet-profile',
    loadComponent: () =>
      import('./vet-profile/vet-profile.component').then(
        (m) => m.VetProfileComponent
      ),
  },
  {
    path: 'verification-pending',
    loadComponent: () =>
      import('./verification-pending/verification-pending.component').then(
        (m) => m.VerificationPendingComponent
      ),
  },
  {
    path: 'verification-rejected',
    loadComponent: () =>
      import('./verification-rejected/verification-rejected.component').then(
        (m) => m.VerificationRejectedComponent
      ),
  },
  {
    path: '',
    redirectTo: 'welcome',
    pathMatch: 'full',
  },
];
