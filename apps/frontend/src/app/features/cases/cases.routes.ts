import { Routes } from '@angular/router';

export const CASES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./cases-list/cases-list.component').then(
        (m) => m.CasesListComponent
      ),
  },
  {
    path: 'new',
    loadComponent: () =>
      import('./new-case/new-case.component').then((m) => m.NewCaseComponent),
  },
  {
    path: ':id/symptoms',
    loadComponent: () =>
      import('./symptoms/symptoms.component').then((m) => m.SymptomsComponent),
  },
  {
    path: ':id/ai-results',
    loadComponent: () =>
      import('./ai-results/ai-results.component').then(
        (m) => m.AiResultsComponent
      ),
  },
  {
    path: ':id/test-selection',
    loadComponent: () =>
      import('./test-selection/test-selection.component').then(
        (m) => m.TestSelectionComponent
      ),
  },
  {
    path: ':id/order',
    loadComponent: () =>
      import('./order/order.component').then((m) => m.OrderComponent),
  },
  {
    path: ':id/order/success',
    loadComponent: () =>
      import('./order-success/order-success.component').then(
        (m) => m.OrderSuccessComponent
      ),
  },
  {
    path: ':id/report',
    loadComponent: () =>
      import('./report/report.component').then((m) => m.ReportComponent),
  },
];
