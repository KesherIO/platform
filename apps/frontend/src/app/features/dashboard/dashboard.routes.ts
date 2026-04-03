import { Routes } from '@angular/router';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./dashboard-shell/dashboard-shell.component').then(
        m => m.DashboardShellComponent,
      ),
    children: [
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
      },
      {
        path: 'home',
        loadComponent: () =>
          import('./home/home.component').then(m => m.HomeComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('../settings/settings-shell/settings-shell.component').then(
            m => m.SettingsShellComponent,
          ),
      },
    ],
  },
];