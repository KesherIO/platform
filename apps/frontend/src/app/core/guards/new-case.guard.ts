import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { TenantService } from '../services/tenant.service';

/**
 * No new cases while the clinic's lab has suspended services — a case can
 * only lead to triage or an order through that lab. Editing an existing case
 * (same route, with editCaseId in the navigation state) stays allowed.
 */
export const newCaseGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (!inject(TenantService).labServicesSuspended()) return true;

  const state = router.getCurrentNavigation()?.extras.state as
    | { editCaseId?: string }
    | undefined;
  if (state?.editCaseId) return true;

  return router.createUrlTree(['/cases']);
};
