import { Routes } from '@angular/router';

export const CASES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./cases-list/cases-list.component').then(m => m.CasesListComponent)
  },
  {
    path: 'new',
    loadComponent: () => import('./case-form/case-form.component').then(m => m.CaseFormComponent)
  },
  {
    path: ':id',
    loadComponent: () => import('./case-detail/case-detail.component').then(m => m.CaseDetailComponent),
    children: [
      {
        path: 'symptoms',
        loadComponent: () => import('../../features/symptoms/symptoms.component').then(m => m.SymptomsComponent)
      },
      {
        path: 'orders',
        loadComponent: () => import('../../features/orders/orders.component').then(m => m.OrdersComponent)
      },
      {
        path: 'results',
        loadComponent: () => import('../../features/results/results.component').then(m => m.ResultsComponent)
      },
      {
        path: 'reports',
        loadComponent: () => import('../../features/reports/reports.component').then(m => m.ReportsComponent)
      }
    ]
  }
];